"use client";

import { useState } from "react";
import type { Doctor, Grant, Report, Specialty } from "@/lib/api";
import { specialtyHint, specialtyLabels } from "@/lib/specialty";

type PresenceFilter = "ALL" | "ONLINE" | "OFFLINE";

export function DoctorChooser({ report, allReports, doctors, grants, selectedId, busy, onSelect, onGrant, onGrantEmail }: {
  report: Report;
  allReports: Report[];
  doctors: Doctor[];
  grants: Grant[];
  selectedId: number | null;
  busy: boolean;
  onSelect: (doctorId: number) => void;
  onGrant: (doctor: Doctor) => void;
  onGrantEmail: (email: string) => void;
}) {
  const [specialty, setSpecialty] = useState<Specialty | "ALL">("ALL");
  const [presence, setPresence] = useState<PresenceFilter>("ALL");
  const [doctorEmail, setDoctorEmail] = useState("");
  const hint = specialtyHint(report, allReports);
  const options = doctors.filter(doctor => (specialty === "ALL" || doctor.specialty === specialty)
    && (presence === "ALL" || (presence === "ONLINE" ? doctor.online : !doctor.online)))
    .sort((a, b) => Number(b.online) - Number(a.online) || Number(b.specialty === hint.primary) - Number(a.specialty === hint.primary));
  const chosen = doctors.find(doctor => doctor.id === selectedId);
  const alreadyGranted = chosen && grants.some(grant => grant.doctorId === chosen.id);

  return <div className="doctor-chooser">
    <div className="specialty-hint"><span className="badge">科室选择提示</span><strong>建议先看{specialtyLabels[hint.primary]}</strong><p>{hint.explanation}</p><small>仅根据已录入报告给出选择方向，不判断病情轻重；最终由医生结合症状、病史与复查结果决定。</small></div>
    <div className="doctor-filters" aria-label="筛选医生科室">
      {(["ALL", "GENERAL", "CARDIOLOGY", "ENDOCRINOLOGY"] as (Specialty | "ALL")[]).map(item => <button type="button" key={item} className={specialty === item ? "active" : ""} onClick={() => setSpecialty(item)}>{item === "ALL" ? "全部" : specialtyLabels[item]}</button>)}
    </div>
    <label className="doctor-presence-filter">医生在线状态
      <select value={presence} onChange={event => setPresence(event.target.value as PresenceFilter)}>
        <option value="ALL">全部</option><option value="ONLINE">在线</option><option value="OFFLINE">离线</option>
      </select>
    </label>
    {options.length > 0 && <p className="doctor-list-hint">共 {options.length} 位医生；可在下方列表内滚动查看更多。</p>}
    <div className="doctor-options" role="region" aria-label="医生列表，可滚动" tabIndex={0}>{options.map(doctor => <button type="button" key={doctor.id} className={`doctor-option ${selectedId === doctor.id ? "selected" : ""}`} aria-pressed={selectedId === doctor.id} onClick={() => onSelect(doctor.id)}>
      <span className="doctor-option-main"><span className="doctor-avatar" aria-hidden="true">{doctor.displayName.slice(0, 1)}</span>
      <span className="doctor-option-text"><strong>{doctor.displayName}</strong><small>{doctor.email}</small><small>{specialtyLabels[doctor.specialty]}</small></span></span>
      <span className="doctor-option-meta"><span className={`presence ${doctor.online ? "online" : ""}`}>{doctor.online ? "在线" : "离线"}</span>
      {doctor.specialty === hint.primary && <em>推荐</em>}
      {grants.some(grant => grant.doctorId === doctor.id) && <em>已授权</em>}</span>
    </button>)}</div>
    {options.length === 0 && <p className="note">当前筛选下没有医生；可将科室和在线状态切换为“全部”。</p>}
    <div className="doctor-choice-action"><button disabled={busy || !chosen || Boolean(alreadyGranted)} onClick={() => chosen && onGrant(chosen)}>{alreadyGranted ? "已授权此医生" : chosen ? `授权 ${chosen.displayName} 查看此报告` : "先选择一位医生"}</button><small>授权仅限当前报告；离线医生可在之后登录查看消息，若希望尽快得到回复可选择在线医生。</small></div>
    <form className="doctor-email-grant" onSubmit={event => { event.preventDefault(); if (doctorEmail.trim()) onGrantEmail(doctorEmail.trim()); }}>
      <label htmlFor={`doctor-email-${report.id}`}>通过医生账号（邮箱）授权</label>
      <div><input id={`doctor-email-${report.id}`} type="email" required value={doctorEmail} onChange={event => setDoctorEmail(event.target.value)} placeholder="输入你认识的医生的注册邮箱" /><button type="submit" disabled={busy || !doctorEmail.trim()}>授权此医生</button></div>
      <small>仅能授权已经注册为医生的账号；输入普通用户或不存在的邮箱不会授权。</small>
    </form>
  </div>;
}
