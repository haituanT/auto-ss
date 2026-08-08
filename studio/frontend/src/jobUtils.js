export const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "interrupted"]);
export const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

export function finiteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(finiteNumber(value, 0))));
}

export function formatElapsedMs(value) {
  const seconds = Math.max(0, Math.floor(finiteNumber(value, 0) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function jobElapsedMs(job) {
  const start = Date.parse(job?.startedAt || job?.createdAt || "");
  if (!Number.isFinite(start)) return 0;
  const end = ACTIVE_JOB_STATUSES.has(job?.status)
    ? Date.now()
    : Date.parse(job?.finishedAt || job?.updatedAt || "") || Date.now();
  return Math.max(0, end - start);
}

export function jobFamily(job) {
  if (job?.family) return job.family;
  if (["remotion-render", "remotion-check"].includes(job?.type)) return "render";
  if (["generate-vo", "generate-vo-sample", "trim-vo"].includes(job?.type)) return "audio";
  if (job?.type === "illustration-generate") return "illustration";
  if (job?.type === "character-convert") return "character";
  return job?.type || "job";
}

export function isRunningJob(job) {
  return ACTIVE_JOB_STATUSES.has(job?.status);
}

export function isTerminalJob(job) {
  return TERMINAL_JOB_STATUSES.has(job?.status);
}

export function isAudioJob(job) {
  return jobFamily(job) === "audio";
}

export function isRenderJob(job) {
  return jobFamily(job) === "render";
}

export function newestJob(jobs, slug, predicate = () => true) {
  return [...(jobs || [])]
    .filter((job) => (!slug || job.slug === slug) && predicate(job))
    .sort((a, b) => String(b.updatedAt || b.finishedAt || b.startedAt || b.createdAt || "")
      .localeCompare(String(a.updatedAt || a.finishedAt || a.startedAt || a.createdAt || "")))[0] || null;
}

export function jobTypeLabel(job) {
  if (job?.type === "remotion-render") return "Render";
  if (job?.type === "remotion-check") return "Kiểm tra";
  if (job?.type === "generate-vo" || job?.type === "generate-vo-sample") return "Tạo âm thanh";
  if (job?.type === "trim-vo") return "Cắt nghỉ VO";
  if (job?.type === "illustration-generate") return "Tạo ảnh AI";
  if (job?.type === "character-convert") return "Nhân vật";
  return job?.type || "Job";
}

export function jobStatusLabel(job) {
  if (job?.status === "queued") return "Đang chờ";
  if (job?.status === "running") return "Đang chạy";
  if (job?.status === "completed") return "Hoàn tất";
  if (job?.status === "failed") return "Lỗi";
  if (job?.status === "cancelled") return "Đã dừng";
  if (job?.status === "interrupted") return "Gián đoạn";
  return job?.status || "";
}

export function jobTone(job) {
  if (job?.status === "failed" || job?.status === "interrupted") return "bad";
  if (job?.status === "cancelled") return "cancelled";
  if (job?.status === "completed") return "done";
  if (job?.status === "queued") return "queued";
  return "running";
}

export function progressFromLogs(job, logs = "") {
  if (!logs) return clampPercent(job?.progress || 0);
  const encoded = [...logs.matchAll(/Encoded\s+(\d+)\/(\d+)/gi)].pop();
  if (encoded) return clampPercent(88 + ((Number(encoded[1]) || 0) / Math.max(1, Number(encoded[2]) || 1)) * 11);
  const rendered = [...logs.matchAll(/Rendered\s+(\d+)\/(\d+)/gi)].pop();
  if (rendered) return clampPercent(8 + ((Number(rendered[1]) || 0) / Math.max(1, Number(rendered[2]) || 1)) * 78);
  const trim = [...logs.matchAll(/Trimmed\s+(\d+)\/(\d+)\s+VO line/gi)].pop();
  if (trim) return clampPercent(12 + ((Number(trim[1]) || 0) / Math.max(1, Number(trim[2]) || 1)) * 82);
  return clampPercent(job?.progress || 0);
}

export function visibleGlobalJobs(jobs, now = Date.now()) {
  return [...(jobs || [])]
    .filter((job) => {
      if (isRunningJob(job)) return true;
      const finished = Date.parse(job?.finishedAt || job?.updatedAt || "");
      if (!Number.isFinite(finished)) return false;
      if (job.status === "completed") return now - finished < 25000;
      return now - finished < 90000;
    })
    .sort((a, b) => String(b.updatedAt || b.finishedAt || b.startedAt || b.createdAt || "")
      .localeCompare(String(a.updatedAt || a.finishedAt || a.startedAt || a.createdAt || "")));
}
