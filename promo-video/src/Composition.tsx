import type { CalculateMetadataFunction } from "remotion";
import { Composition, staticFile } from "remotion";
import {
  InkForgePromo,
  InkForgePromoVoiceover,
  type InkForgePromoVoiceoverProps,
  type ManboVoiceoverTimeline,
} from "./InkForgePromo";
import {
  InkForgeLongformSoftAd,
  type LongformSoftAdProps,
  type LongformTimeline,
} from "./LongformSoftAd";

const calculateVoiceoverMetadata: CalculateMetadataFunction<
  InkForgePromoVoiceoverProps
> = async ({ props, abortSignal }) => {
  const response = await fetch(staticFile("voiceover/manbo/timeline.json"), {
    signal: abortSignal,
  });
  if (!response.ok) {
    throw new Error(
      `Voiceover timeline request failed with HTTP ${response.status}`,
    );
  }
  const timeline = (await response.json()) as ManboVoiceoverTimeline;
  return {
    durationInFrames: timeline.totalDurationInFrames,
    defaultOutName: "inkforge-github-promo-manbo.mp4",
    props: {
      ...props,
      timeline,
    },
  };
};

const calculateLongformMetadata: CalculateMetadataFunction<
  LongformSoftAdProps
> = async ({ props, abortSignal }) => {
  const response = await fetch(
    staticFile("voiceover/manbo-longform/timeline.json"),
    {
      signal: abortSignal,
    },
  );
  if (!response.ok) {
    throw new Error(
      `Longform timeline request failed with HTTP ${response.status}`,
    );
  }
  const timeline = (await response.json()) as LongformTimeline;
  return {
    durationInFrames: timeline.totalDurationInFrames,
    defaultOutName: "inkforge-longform-soft-ad.mp4",
    props: {
      ...props,
      timeline,
    },
  };
};

export const MyComposition = () => {
  return (
    <>
      <Composition
        id="InkForgePromo"
        component={InkForgePromo}
        durationInFrames={720}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="InkForgePromoVoiceover"
        component={InkForgePromoVoiceover}
        durationInFrames={985}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ timeline: null }}
        calculateMetadata={calculateVoiceoverMetadata}
      />
      <Composition
        id="InkForgeLongformSoftAd"
        component={InkForgeLongformSoftAd}
        durationInFrames={6603}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ timeline: null }}
        calculateMetadata={calculateLongformMetadata}
      />
    </>
  );
};
