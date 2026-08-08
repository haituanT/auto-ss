import React from "react";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, LoaderCircle } from "lucide-react";
import {
  clampPercent,
  formatElapsedMs,
  isRunningJob,
  jobElapsedMs,
  jobStatusLabel,
  jobTone,
  jobTypeLabel,
  visibleGlobalJobs,
} from "../jobUtils.js";

function JobStatusIcon({ job }) {
  if (job?.status === "completed") return <CheckCircle2 size={14} />;
  if (job?.status === "failed" || job?.status === "interrupted") return <AlertTriangle size={14} />;
  if (job?.status === "queued") return <Clock3 size={14} />;
  return <LoaderCircle className="spin-icon" size={14} />;
}

function compactJobLabel(job) {
  const slug = job?.slug || "global";
  const progress = clampPercent(job?.progress || 0);
  const suffix = isRunningJob(job) ? ` ${progress}%` : "";
  return `${slug} · ${jobTypeLabel(job)}${suffix}`;
}

export function GlobalJobStrip({ jobs = [], selectedJobId = "", onOpenJob = () => {} }) {
  const visible = visibleGlobalJobs(jobs).slice(0, 6);
  return (
    <div className="global-job-strip" aria-label="Trạng thái job toàn cục">
      {visible.length ? visible.map((job) => (
        <button
          type="button"
          key={job.id}
          className={`global-job-badge ${jobTone(job)} ${selectedJobId === job.id ? "selected" : ""}`}
          title={`${job.slug || "global"} - ${jobTypeLabel(job)} - ${jobStatusLabel(job)}${job.message ? ` - ${job.message}` : ""}`}
          onClick={() => onOpenJob(job)}
        >
          <JobStatusIcon job={job} />
          <span>{compactJobLabel(job)}</span>
        </button>
      )) : (
        <span className="global-job-empty">Không có job nền</span>
      )}
    </div>
  );
}

function JobProgressCell({ job }) {
  const percent = clampPercent(job?.progress || 0);
  return (
    <div className="home-job-progress">
      <div className="progress-track" role="progressbar" aria-label={jobTypeLabel(job)} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent}>
        <div style={{ width: `${percent}%` }} />
      </div>
      <span>{percent}%</span>
    </div>
  );
}

function HomeJobRow({ job, onOpenJob, onOpenProject }) {
  const canOpenProject = Boolean(job?.slug);
  return (
    <div className={`home-job-row ${jobTone(job)}`}>
      <div className="home-job-project"><strong>{job.slug || "global"}</strong><span>{job.id.slice(0, 8)}</span></div>
      <div><strong>{jobTypeLabel(job)}</strong><span>{job.message || jobStatusLabel(job)}</span></div>
      <JobProgressCell job={job} />
      <div><strong>{formatElapsedMs(jobElapsedMs(job))}</strong><span>{jobStatusLabel(job)}</span></div>
      <div className="home-job-actions">
        <button type="button" onClick={() => onOpenJob(job)}>Log</button>
        <button type="button" disabled={!canOpenProject} onClick={() => canOpenProject && onOpenProject(job.slug)}>
          <ExternalLink size={14} /> Mo
        </button>
      </div>
    </div>
  );
}

export function HomeJobsPanel({ jobs = [], onOpenJob = () => {}, onOpenProject = () => {} }) {
  const active = jobs.filter(isRunningJob);
  const recent = jobs.filter((job) => !isRunningJob(job)).slice(0, 10);
  return (
    <section className="panel home-jobs-panel">
      <div className="home-jobs-head">
        <div><span className="eyebrow">Đang xử lý</span><h2>Job nền toàn cục</h2></div>
        <span>{active.length} đang chạy</span>
      </div>
      <div className="home-job-table">
        <div className="home-job-row head">
          <span>Project</span><span>Việc đang làm</span><span>Tiến độ</span><span>Thời gian</span><span>Mở</span>
        </div>
        {active.length ? active.map((job) => (
          <HomeJobRow key={job.id} job={job} onOpenJob={onOpenJob} onOpenProject={onOpenProject} />
        )) : <div className="home-job-empty">Không có job đang chạy.</div>}
      </div>
      <div className="home-jobs-history">
        <strong>Gần đây</strong>
        {recent.length ? recent.map((job) => (
          <HomeJobRow key={job.id} job={job} onOpenJob={onOpenJob} onOpenProject={onOpenProject} />
        )) : <div className="home-job-empty">Chưa có lịch sử job.</div>}
      </div>
    </section>
  );
}
