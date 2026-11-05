"use client";

import { useState } from "react";
import type { Doctor, Grant, Report, Specialty } from "@/lib/api";
import { specialtyHint, specialtyLabels } from "@/lib/specialty";

type Filter = Specialty | "ALL" | "ONLINE";

export function DoctorChooser({ report, allReports, doctors, grants, selectedId, busy, onSelect, onGrant }: {
  report: Report;
  allReports: Report[];
  doctors: Doctor[];
  grants: Grant[];
  selectedId: number | null;
  busy: boolean;
  onSelect: (doctorId: number) => void;
  onGrant: (doctor: Doctor) => void;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const hint = specialtyHint(report, allReports);
  const options = doctors.filter(doctor => filter === "ALL" || (filter === "ONLINE" ? doctor.online : doctor.specialty === filter))
    .sort((a, b) => Number(b.online) - Number(a.online) || Number(b.specialty === hint.primary) - Number(a.specialty === hint.primary));
  const chosen = doctors.find(doctor => doctor.id === selectedId);
  const alreadyGranted = chosen && grants.some(grant => grant.doctorId === chosen.id);

  return <div className="doctor-chooser">
    <div className="specialty-hint"><span className="badge">科室选择提示</span><strong>建议先看{specialtyLabels[hint.primary]}</strong><p>{hint.explanation}</p><small>仅根据已录入报告给出选择方向，不判断病情轻重；最终由医生结合症状、病史与复查结果决定。</small></div>
    <div className="doctor-filters" aria-label="筛选医生科室">
      {(["ALL", "ONLINE", "GENERAL", "CARDIOLOGY", "ENDOCRINOLOGY"] as Filter[]).map(item => <button type="button" key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "ALL" ? "全部" : item === "ONLINE" ? "在线" : specialtyLabels[item]}</button>)}
    </div>
    <div className="doctor-options">{options.map(doctor => <button type="button" key={doctor.id} className={`doctor-option ${selectedId === doctor.id ? "selected" : ""}`} aria-pressed={selectedId === doctor.id} onClick={() => onSelect(doctor.id)}>
      <span className="doctor-avatar" aria-hidden="true">{doctor.displayName.slice(0, 1)}</span>
      <span><strong>{doctor.displayName}</strong><small>{specialtyLabels[doctor.specialty]} · 演示账号</small></span>
      <span className={`presence ${doctor.online ? "online" : ""}`}>{doctor.online ? "在线" : "离线"}</span>
      {doctor.specialty === hint.primary && <em>推荐</em>}
      {grants.some(grant => grant.doctorId === doctor.id) && <em>已授权</em>}
    </button>)}</div>
    {options.length === 0 && <p className="note">当前筛选下没有医生；可切换到“全部”查看演示账号。</p>}
    <div className="doctor-choice-action"><button disabled={busy || !chosen || Boolean(alreadyGranted)} onClick={() => chosen && onGrant(chosen)}>{alreadyGranted ? "已授权此医生" : chosen ? `授权 ${chosen.displayName} 查看此报告` : "先选择一位医生"}</button><small>授权仅限当前报告；离线医生可在之后登录查看消息。</small></div>
  </div>;
}
