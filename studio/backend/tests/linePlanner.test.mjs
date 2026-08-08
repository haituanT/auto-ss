import assert from "node:assert/strict";
import test from "node:test";
import { planGroupedLines, planLines, splitContentLines } from "../services/linePlanner.mjs";

test("line planner maps Vietnamese A/B/question lines to the expected poses", () => {
  const lines = planLines({
    leftLabel: "Ly thân",
    rightLabel: "Ly hôn",
    content: `Đây là ly thân,
đây là ly hôn.
Sự khác biệt ở đâu??
Ly thân là khi hai vợ chồng không còn sống chung.
Còn ly hôn là khi quan hệ vợ chồng chấm dứt.`,
  });

  assert.deepEqual(lines.map((line) => [line.role, line.pose, line.focusSide]), [
    ["A", "point-left", "right"],
    ["B", "point-right", "left"],
    ["question", "question", "center"],
    ["A", "point-left", "right"],
    ["B", "point-right", "left"],
  ]);
});

test("line planner derives left/right subjects from the first two spoken lines", () => {
  const lines = planLines({
    leftLabel: "Nội dung A",
    rightLabel: "Nội dung B",
    content: `Đây là vàng miếng,
đây là vàng nhẫn.
Khác nhau ở đâu?
Vàng miếng thường có seri rõ ràng.
Còn vàng nhẫn dễ mua theo số tiền nhỏ hơn.`,
  });

  assert.deepEqual(lines.map((line) => [line.role, line.pose, line.focusSide, line.sfx]), [
    ["A", "point-left", "right", "mixkit-hard-pop-click.wav"],
    ["B", "point-right", "left", "mixkit-hard-pop-click.wav"],
    ["question", "question", "center", "mixkit-bubble-pop.wav"],
    ["A", "point-left", "right", "mixkit-hard-pop-click.wav"],
    ["B", "point-right", "left", "mixkit-hard-pop-click.wav"],
  ]);
});

test("line planner keeps a manually selected pose even when text changes", () => {
  const lines = planLines({
    leftLabel: "A",
    rightLabel: "B",
    content: "Updated text that still belongs to the selected right-side character.",
    previousLines: [
      {
        id: "line-1",
        text: "Old text",
        pose: "point-right",
        poseLocked: true,
        sfx: "mixkit-hard-pop-click.wav",
      },
    ],
  });

  assert.equal(lines[0].pose, "point-right");
  assert.equal(lines[0].focusSide, "left");
  assert.equal(lines[0].role, "B");
  assert.equal(lines[0].poseLocked, true);
});

test("line planner keeps a manually selected focus side when text is unchanged", () => {
  const lines = planLines({
    leftLabel: "A",
    rightLabel: "B",
    content: "Old text",
    previousLines: [
      {
        id: "line-1",
        text: "Old text",
        pose: "point-left",
        focusSide: "center",
        focusSideLocked: true,
      },
    ],
  });

  assert.equal(lines[0].pose, "point-left");
  assert.equal(lines[0].focusSide, "center");
  assert.equal(lines[0].focusSideLocked, true);
});

test("line planner repairs unlocked stale focus side from the current pose", () => {
  const lines = planLines({
    leftLabel: "A",
    rightLabel: "B",
    content: "Day la B.",
    previousLines: [
      {
        id: "line-1",
        text: "Day la B.",
        pose: "point-right",
        focusSide: "left",
        focusSideLocked: false,
      },
    ],
  });

  assert.equal(lines[0].pose, "point-right");
  assert.equal(lines[0].focusSide, "left");
  assert.equal(lines[0].focusSideLocked, false);
});

test("line planner only auto-uses question on the third line", () => {
  const lines = planLines({
    leftLabel: "A",
    rightLabel: "B",
    content: `Why is this first line a question?
This line mentions B.
What is different?
Another question after the hook?
Final question too?`,
  });

  assert.deepEqual(lines.map((line) => line.pose), [
    "point-left",
    "point-right",
    "question",
    "point-left",
    "point-right",
  ]);
});

test("line planner can force reassign stale poses and sounds", () => {
  const lines = planLines({
    leftLabel: "Nội dung A",
    rightLabel: "Nội dung B",
    content: `Đây là vàng miếng,
đây là vàng nhẫn.
Khác nhau ở đâu?`,
    previousLines: [
      { id: "line-1", text: "Đây là vàng miếng,", pose: "point-left", sfx: "pop-left.mp3" },
      { id: "line-2", text: "đây là vàng nhẫn.", pose: "question", sfx: "question-pop.mp3" },
      { id: "line-3", text: "Khác nhau ở đâu?", pose: "point-right", sfx: "pop-right.mp3" },
    ],
    preserveExisting: false,
  });

  assert.deepEqual(lines.map((line) => [line.pose, line.sfx]), [
    ["point-left", "mixkit-hard-pop-click.wav"],
    ["point-right", "mixkit-hard-pop-click.wav"],
    ["question", "mixkit-bubble-pop.wav"],
  ]);
});

test("forced pose assignment can start on the right and keep alternating", () => {
  const lines = planLines({
    leftLabel: "A",
    rightLabel: "B",
    content: "A\nB\nQuestion?\nLeft explanation\nRight explanation\nMore left\nMore right",
    forceAlternatingPoses: true,
    poseStartSide: "right",
  });

  assert.deepEqual(lines.map((line) => line.pose), [
    "point-right",
    "point-left",
    "question",
    "point-right",
    "point-left",
    "point-right",
    "point-left",
  ]);
  assert.deepEqual(lines.map((line) => line.focusSide), [
    "left",
    "right",
    "center",
    "left",
    "right",
    "left",
    "right",
  ]);
});

test("content side inference wins over the fallback start side", () => {
  const lines = planLines({
    leftLabel: "Thị trấn",
    rightLabel: "Thị xã",
    content: "Đây là trường THPT chuyên.\nĐây là trường THPT.",
    poseStartSide: "right",
  });

  assert.deepEqual(lines.map((line) => [line.role, line.pose, line.focusSide]), [
    ["A", "point-left", "right"],
    ["B", "point-right", "left"],
  ]);
});

test("line planner migrates preserved legacy sound names", () => {
  const lines = planLines({
    leftLabel: "A",
    rightLabel: "B",
    content: "Đây là A.",
    previousLines: [
      { id: "line-1", text: "Đây là A.", pose: "point-left", sfx: "pop-left.mp3" },
    ],
  });

  assert.equal(lines[0].sfx, "mixkit-hard-pop-click.wav");
});

test("forced grouped pose reassignment alternates across compare sets and keeps timing", () => {
  const previousLines = [
    "A1",
    "B1",
    "Question?",
    "Neutral one",
    "A2",
    "B2",
  ].map((text, index) => ({
    id: `line-${index + 1}`,
    compareSetId: index >= 4 ? "compare-2" : "compare-1",
    text,
    start: index + 0.5,
    duration: 1.2,
    pose: "point-left",
  }));

  const lines = planGroupedLines({
    contentByCompareSet: {
      "compare-1": "A1\nB1\nQuestion?\nNeutral one",
      "compare-2": "A2\nB2",
    },
    compareSets: [
      { id: "compare-1", leftLabel: "A1", rightLabel: "B1" },
      { id: "compare-2", leftLabel: "A2", rightLabel: "B2" },
    ],
    previousLines,
    preserveExisting: false,
    forceAlternatingPoses: true,
  });

  assert.deepEqual(lines.map((line) => line.pose), [
    "point-left",
    "point-right",
    "question",
    "point-left",
    "point-right",
    "point-left",
  ]);
  assert.deepEqual(lines.map((line) => line.start), previousLines.map((line) => line.start));
  assert.equal(lines.some((line) => line.dirtyVoice), false);
});

test("split content lines separates numbered pasted text", () => {
  assert.deepEqual(splitContentLines("1. Dong A 2. Dong B\n3. Dong C"), [
    "Dong A",
    "Dong B",
    "Dong C",
  ]);
});
