import { Composition } from 'remotion';
import { Labotech } from './Labotech';

export const Root = () => (
  <Composition
    id="Labotech"
    component={Labotech}
    durationInFrames={540}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{}}
  />
);
