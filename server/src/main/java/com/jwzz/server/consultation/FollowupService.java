package com.jwzz.server.consultation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jwzz.server.auth.UserStore;
import com.jwzz.server.common.ChatPage;
import com.jwzz.server.notification.NotificationOutbox;
import com.jwzz.server.report.ReportStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.*;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class FollowupService {
    public record Proposal(@NotBlank @Size(max=300) String title, Instant dueAt) {}
    public record CloseRequest(@NotBlank @Size(max=2000) String summary, @NotNull @Size(max=10) List<@NotNull @Valid Proposal> tasks) {}
    public record AddRequest(@NotBlank @Size(max=300) String title, @NotNull Instant dueAt,
        @NotBlank @Pattern(regexp="[A-Za-z0-9-]{8,64}") String clientKey) {}
    public record Task(long id,String title,Instant dueAt,String status,Long reportId,boolean reportHidden) {}
    public record Detail(long consultationId,long reportId,String status,String summary,LocalDateTime closedAt,List<Task> tasks) {}
    public record Summary(long id,long reportId,String summary,LocalDateTime closedAt) {}
    private final JdbcTemplate db;
    private final ConsultationStore consultations;
    private final ReportStore reports;
    private final NotificationOutbox events;
    private final ObjectMapper json;
    public FollowupService(JdbcTemplate db,ConsultationStore consultations,ReportStore reports,NotificationOutbox events,ObjectMapper json) {
        this.db=db;this.consultations=consultations;this.reports=reports;this.events=events;this.json=json;
    }
    private ResponseStatusException missing() { return new ResponseStatusException(HttpStatus.NOT_FOUND,"咨询或待办不存在，或授权已撤销"); }
    private void conflict(String message) { throw new ResponseStatusException(HttpStatus.CONFLICT,message); }
    private ConsultationStore.Consultation access(long id,UserStore.User actor,boolean lock) {
        if(!Set.of("USER","DOCTOR").contains(actor.role())) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        // Authentication may already have opened a repeatable-read snapshot. Locking read is the current state.
        var locked=lock?consultations.findLocked(id).orElseThrow(this::missing):null;
        var visible=(actor.role().equals("DOCTOR") ? consultations.findForDoctor(id,actor.id())
            .filter(c->Objects.equals(c.claimedDoctorId(),actor.id())) : consultations.find(id).filter(c->c.userId()==actor.id()))
            .orElseThrow(this::missing);
        return locked==null?visible:locked;
    }
    private void userOnly(UserStore.User actor) { if(!actor.role().equals("USER")) throw new ResponseStatusException(HttpStatus.FORBIDDEN); }
    private void validateTime(Instant due) {
        if(due==null || !due.isAfter(Instant.now()) || due.isAfter(Instant.now().plus(Duration.ofDays(730))))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请选择未来两年内的提醒时间");
    }
    private LocalDateTime utc(Instant value) { return value==null?null:LocalDateTime.ofInstant(value.truncatedTo(java.time.temporal.ChronoUnit.MICROS),ZoneOffset.UTC); }
    private LocalDateTime databaseTime(Object value) {
        if(value==null) return null;
        return value instanceof LocalDateTime local ? local : ((java.sql.Timestamp)value).toLocalDateTime();
    }
    public ChatPage<Summary> page(UserStore.User actor,Long before,int size) {
        ChatPage.validate(before,null,size);
        if(!Set.of("USER","DOCTOR").contains(actor.role())) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        String where=actor.role().equals("USER")?"c.user_id=?":"c.claimed_doctor_id=? AND EXISTS (SELECT 1 FROM report_access_grant g WHERE g.report_id=c.report_id AND g.doctor_id=c.claimed_doctor_id AND g.revoked_at IS NULL)";
        var args=new ArrayList<Object>();args.add(actor.id());if(before!=null)args.add(before);args.add(size+1);
        return ChatPage.of(db.query("SELECT c.id,c.report_id,x.summary,x.closed_at FROM consultation_request c JOIN consultation_closure x ON x.consultation_id=c.id WHERE "+where+(before==null?"":" AND c.id<?")+" ORDER BY c.id DESC LIMIT ?",
            (rs,n)->new Summary(rs.getLong("id"),rs.getLong("report_id"),rs.getString("summary"),rs.getTimestamp("closed_at").toLocalDateTime()),args.toArray()),size,false);
    }
    public Detail detail(long id,UserStore.User actor) {
        var c=access(id,actor,false);
        var closure=db.queryForList("SELECT summary,closed_at FROM consultation_closure WHERE consultation_id=?",id);
        var tasks=db.query("SELECT * FROM followup_task WHERE consultation_id=? ORDER BY id",(rs,n)->{
            Long report=rs.getObject("report_id",Long.class);
            boolean hidden=report!=null && actor.role().equals("DOCTOR") && !reports.activeGrant(report,actor.id());
            var due=rs.getTimestamp("due_at");
            return new Task(rs.getLong("id"),rs.getString("title"),due==null?null:due.toLocalDateTime().toInstant(ZoneOffset.UTC),rs.getString("status"),hidden?null:report,hidden);
        },id);
        // Recheck the root grant after reading child rows, not just the list page.
        access(id,actor,false);
        return new Detail(id,c.reportId(),c.status(),closure.isEmpty()?null:(String)closure.get(0).get("summary"),
            closure.isEmpty()?null:databaseTime(closure.get(0).get("closed_at")),tasks);
    }
    @Transactional
    public Detail close(long id,CloseRequest request,UserStore.User actor) {
        if(!actor.role().equals("DOCTOR")) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        var c=access(id,actor,true);
        String payload;
        try { payload=json.writeValueAsString(request); } catch(Exception ex) { throw new IllegalArgumentException(ex); }
        if(c.status().equals("CLOSED")) {
            String old=db.queryForObject("SELECT request_json FROM consultation_closure WHERE consultation_id=?",String.class,id);
            try { if(!json.readTree(old).equals(json.readTree(payload))) conflict("咨询已结束，不能覆盖原沟通记录"); }
            catch(java.io.IOException ex) { throw new IllegalStateException(ex); }
            return detail(id,actor);
        }
        if(!Set.of("CLAIMED","ANSWERED").contains(c.status())) conflict("请先接受咨询");
        for(var task:request.tasks()) if(task.dueAt()!=null) validateTime(task.dueAt());
        db.update("UPDATE consultation_request SET status='CLOSED' WHERE id=?",id);
        db.update("INSERT INTO consultation_closure(consultation_id,summary,request_json) VALUES (?,?,?)",id,request.summary().trim(),payload);
        int index=0;
        for(var task:request.tasks()) db.update("INSERT INTO followup_task(consultation_id,creator_id,client_key,title,due_at,status) VALUES (?,?,?,?,?,'PROPOSED')",
            id,actor.id(),"doctor-proposal-"+(index++),task.title().trim(),utc(task.dueAt()));
        events.enqueue("consultation:"+id+":closed",NotificationOutbox.Type.CONSULTATION_CLOSED,c.userId(),id);
        return detail(id,actor);
    }
    @Transactional
    public Detail add(long id,AddRequest request,UserStore.User actor) {
        userOnly(actor);var c=access(id,actor,true);
        if(!c.status().equals("CLOSED")) conflict("结束咨询后才能设置随访提醒");
        var old=db.queryForList("SELECT title,original_due_at FROM followup_task WHERE consultation_id=? AND client_key=?",id,request.clientKey());
        if(!old.isEmpty()) {
            if(!Objects.equals(old.get(0).get("title"),request.title().trim()) || !Objects.equals(databaseTime(old.get(0).get("original_due_at")),utc(request.dueAt()))) conflict("提交编号已用于其他内容");
            return detail(id,actor);
        }
        validateTime(request.dueAt());
        if(db.queryForObject("SELECT COUNT(*) FROM followup_task WHERE consultation_id=?",Integer.class,id)>=100) conflict("单次咨询最多保存 100 项待办");
        db.update("INSERT INTO followup_task(consultation_id,creator_id,client_key,title,due_at,original_due_at,status) VALUES (?,?,?,?,?,?,'ACTIVE')",
            id,actor.id(),request.clientKey(),request.title().trim(),utc(request.dueAt()),utc(request.dueAt()));
        return detail(id,actor);
    }
    @Transactional
    public Detail change(long id,long taskId,String action,Instant due,Long report,UserStore.User actor) {
        userOnly(actor);var c=access(id,actor,true);
        var rows=db.queryForList("SELECT * FROM followup_task WHERE id=? AND consultation_id=? FOR UPDATE",taskId,id);
        if(rows.isEmpty()) throw missing();
        var task=rows.get(0);String status=(String)task.get("status");
        switch(action) {
            case "confirm" -> {
                if(Set.of("ACTIVE","NOTIFIED","COMPLETED").contains(status) && Objects.equals(databaseTime(task.get("due_at")),utc(due))) break;
                if(!status.equals("PROPOSED")) conflict("此提醒已处理，不能重复修改");
                validateTime(due);db.update("UPDATE followup_task SET status='ACTIVE',due_at=? WHERE id=?",utc(due),taskId);
            }
            case "cancel" -> {
                if(status.equals("CANCELLED")) break;
                if(status.equals("COMPLETED")) conflict("已完成的待办不能取消");
                db.update("UPDATE followup_task SET status='CANCELLED' WHERE id=?",taskId);
            }
            case "complete" -> {
                if(status.equals("COMPLETED")) {
                    if(!Objects.equals(task.get("report_id"),report)) conflict("待办已完成，不能替换关联报告");
                    break;
                }
                if(!Set.of("ACTIVE","NOTIFIED").contains(status)) conflict("请先确认提醒，或该提醒已取消");
                if(report!=null) {
                    var record=reports.findOwnedById(actor.id(),report).orElseThrow(this::missing);
                    if(record.id()<=c.reportId()) conflict("请关联原报告之后生成的新报告");
                }
                db.update("UPDATE followup_task SET status='COMPLETED',report_id=?,completed_at=CURRENT_TIMESTAMP(6) WHERE id=?",report,taskId);
            }
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        return detail(id,actor);
    }
    @Transactional
    public boolean dispatchDue() {
        var rows=db.queryForList("SELECT id,consultation_id FROM followup_task WHERE status='ACTIVE' AND due_at<=UTC_TIMESTAMP(6) ORDER BY due_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
        if(rows.isEmpty()) return false;
        long id=((Number)rows.get(0).get("id")).longValue(),consultation=((Number)rows.get(0).get("consultation_id")).longValue();
        long owner=db.queryForObject("SELECT user_id FROM consultation_request WHERE id=?",Long.class,consultation);
        events.enqueue("followup:"+id+":due",NotificationOutbox.Type.RECORD_REMINDER_DUE,owner,id);
        db.update("UPDATE followup_task SET status='NOTIFIED' WHERE id=?",id);
        return true;
    }
}
