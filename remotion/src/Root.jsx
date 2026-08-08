import React from "react";
import { Composition } from "remotion";
import { AutoCompareVideo } from "./AutoCompareVideo.jsx";

const FPS = 30;

const defaultProps = {
  title: "Auto Compare",
  leftLabel: "A",
  rightLabel: "B",
  compareSets: [
    { id: "compare-1", leftLabel: "A", rightLabel: "B", leftZoom: 1, rightZoom: 1, leftCrop: { x: 0, y: 0, rotation: 0 }, rightCrop: { x: 0, y: 0, rotation: 0 } },
    { id: "compare-2", leftLabel: "A", rightLabel: "B", leftZoom: 1, rightZoom: 1, leftCrop: { x: 0, y: 0, rotation: 0 }, rightCrop: { x: 0, y: 0, rotation: 0 } }
  ],
  durationInSeconds: 8,
  assetBase: "remotion/jobs/demo",
  assets: {
    background: "background.png",
    logo: "",
    compareSets: {
      "compare-1": { left: "compare-left.png", right: "compare-right.png" },
      "compare-2": { left: "", right: "" }
    },
    compareLeft: "compare-left.png",
    compareRight: "compare-right.png",
    characters: {
      "point-left": "characters/point-left.mov",
      "point-right": "characters/point-right.mov",
      question: "characters/question.mov"
    },
    audio: null,
    audioClips: [],
    sfxClips: [],
    bgm: null
  },
  compare: { leftZoom: 1, rightZoom: 1 },
  logo: {
    enabled: false,
    src: "",
    width: 220,
    anchor: "bottom-right",
    x: -48,
    y: -72,
    opacity: 1,
    layer: "above-character"
  },
  caption: {
    style: "vietnam-bold-highlight",
    animation: "word-pop",
    fontFamily: "Be Vietnam Pro",
    fontSize: 72,
    normalColor: "#20160f",
    hotColor: "#ff4f2f",
    strokeColor: "#fffaf0",
    strokeWidth: 10,
    wordGap: 0,
    uppercase: false,
    shadowPreset: "default"
  },
  character: { scale: 1, x: 0, y: 0 },
  layout: {
    width: 1080,
    height: 1920,
    compareTop: 170,
    compareHeight: 520,
    photoCompareSize: 390,
    photoCompareOffsetY: 0,
    compareLabelPlacement: "auto",
    compareLabelUppercase: true,
    compareLabelBoxEnabled: true,
    compareLabelAlign: "center",
    compareLabelFontSize: 0,
    compareLabelHeight: 110,
    compareLabelPaddingX: 18,
    compareLabelPaddingY: 10,
    compareLabelColor: "#20160f",
    compareLabelBackground: "#fffdf8",
    compareLabelBackgroundOpacity: 0,
    compareLabelBorderColor: "#20160f",
    compareLabelBorderWidth: 0,
    compareLabelRadius: 0,
    compareLabelShadow: "none",
    compareVsColor: "#ff4f2f",
    compareVsTextColor: "#fffdf8",
    compareVsBorderColor: "#20160f",
    photoFrameBorderColor: "#20160f",
    photoFrameShadowColor: "#20160f",
    photoLabelColor: "#20160f",
    focusScaleLarge: 1.18,
    focusScaleSmall: 0.82,
    focusMotionDuration: 0.5,
    focusImageBlur: 2.5,
    focusImageDarkness: 0.35,
    captionY: 900,
    characterY: 1180,
    characterHeight: 650
  },
  audioConfig: { voiceVolume: 1, bgmVolume: 0.18 },
  srt: "",
  lines: []
};

export const Root = () => (
  <Composition
    id="AutoCompare"
    component={AutoCompareVideo}
    durationInFrames={FPS * defaultProps.durationInSeconds}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => {
      const seconds = Number(props.durationInSeconds) || defaultProps.durationInSeconds;
      return {
        durationInFrames: Math.max(FPS, Math.ceil(seconds * FPS))
      };
    }}
  />
);
