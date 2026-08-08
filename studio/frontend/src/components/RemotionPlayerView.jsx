import React from "react";
import { Player } from "@remotion/player";
import { AutoCompareVideo } from "../../../../remotion/src/AutoCompareVideo.jsx";

const RemotionPlayerView = React.forwardRef(function RemotionPlayerView(
  {
    inputProps,
    durationInFrames,
    compositionWidth,
    compositionHeight,
    fps,
    controls = false,
    className,
    style,
    numberOfSharedAudioTags = 5,
    acknowledgeRemotionLicense = true,
    initialFrame,
    moveToBeginningWhenEnded,
  },
  ref,
) {
  return (
    <Player
      ref={ref}
      component={AutoCompareVideo}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={compositionWidth}
      compositionHeight={compositionHeight}
      fps={fps}
      numberOfSharedAudioTags={numberOfSharedAudioTags}
      acknowledgeRemotionLicense={acknowledgeRemotionLicense}
      initialFrame={initialFrame}
      moveToBeginningWhenEnded={moveToBeginningWhenEnded}
      controls={controls}
      className={className}
      style={style}
    />
  );
});

export default RemotionPlayerView;
