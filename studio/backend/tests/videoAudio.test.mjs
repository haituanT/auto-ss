import assert from "node:assert/strict";
import test from "node:test";
import { focusSideForSubtitle, poseForSubtitle } from "../services/videoAudio.mjs";

test("SRT upload keeps the pose selected on the matching existing line", () => {
  const pose = poseForSubtitle(
    { pose: "point-right", poseLocked: true },
    { text: "This cue looks like a question?" },
    4,
  );

  assert.equal(pose, "point-right");
});

test("SRT upload only auto-uses question for the third line", () => {
  const cues = [
    { text: "Question on line one?" },
    { text: "Line two." },
    { text: "Question on line three?" },
    { text: "Question on line four?" },
  ];

  assert.deepEqual(cues.map((cue, index) => poseForSubtitle(null, cue, index)), [
    "point-left",
    "point-right",
    "question",
    "point-left",
  ]);
});

test("SRT upload fallback keeps left right question left right rhythm", () => {
  const cues = [
    { text: "Line one." },
    { text: "Line two." },
    { text: "Question on line three?" },
    { text: "Line four." },
    { text: "Line five." },
    { text: "Line six." },
  ];

  assert.deepEqual(cues.map((cue, index) => poseForSubtitle(null, cue, index)), [
    "point-left",
    "point-right",
    "question",
    "point-left",
    "point-right",
    "point-left",
  ]);
});

test("SRT upload keeps locked focus side on the matching existing line", () => {
  const focusSide = focusSideForSubtitle(
    { pose: "point-right", focusSide: "center", focusSideLocked: true },
    "point-right",
  );

  assert.equal(focusSide, "center");
});
