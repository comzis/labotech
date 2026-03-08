import { AbsoluteFill, Sequence } from 'remotion';
import { Intro } from './scenes/Intro';
import { FeatureEncoder } from './scenes/FeatureEncoder';
import { FeatureTranscode } from './scenes/FeatureTranscode';
import { FeatureMulticast } from './scenes/FeatureMulticast';
import { FeatureTSAnalyser } from './scenes/FeatureTSAnalyser';
import { Outro } from './scenes/Outro';

// Timeline (frames at 30fps):
// 0–90     Intro          (3s)
// 90–180   SRT Encoder    (3s)
// 180–270  Transcoder     (3s)
// 270–360  Multicast      (3s)
// 360–450  TS Analyser    (3s)
// 450–540  Outro          (3s)

export const Labotech = () => (
  <AbsoluteFill style={{ background: '#020617', fontFamily: 'monospace' }}>
    <Sequence from={0}   durationInFrames={90}><Intro /></Sequence>
    <Sequence from={90}  durationInFrames={90}><FeatureEncoder /></Sequence>
    <Sequence from={180} durationInFrames={90}><FeatureTranscode /></Sequence>
    <Sequence from={270} durationInFrames={90}><FeatureMulticast /></Sequence>
    <Sequence from={360} durationInFrames={90}><FeatureTSAnalyser /></Sequence>
    <Sequence from={450} durationInFrames={90}><Outro /></Sequence>
  </AbsoluteFill>
);
