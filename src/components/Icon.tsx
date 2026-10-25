import type { CSSProperties } from 'react';
export type IconName = 'pulse' | 'play' | 'pause' | 'stop' | 'book' | 'chevron' | 'arrow' | 'close' | 'clock' | 'star' | 'radar' | 'text' | 'rewind' | 'check' | 'copy' | 'download' | 'plus' | 'info' | 'spark';
const paths: Record<IconName, string> = {
 pulse: 'M3 12h4l3-8 4 16 3-8h4', play: 'm9 5 11 7-11 7V5Z', pause: 'M8 5v14M16 5v14', stop: 'M6 6h12v12H6z',
 book: 'M12 6C9 3 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-2-9 1Zm0 0v14', chevron: 'm9 5 7 7-7 7',
 arrow: 'M19 12H5m6-6-6 6 6 6', close: 'm6 6 12 12M18 6 6 18', clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
 radar: 'M12 12 19 5M22 12a10 10 0 1 1-10-10M17 12a5 5 0 1 1-5-5M12 12h.01',
 text: 'M8 6h13M8 12h13M8 18h9M3 6h.01M3 12h.01M3 18h.01', rewind: 'M9 7H3V1m0 6a10 10 0 1 1-1 9M12 8v5l3 2',
 check: 'm5 12 4 4L19 6', copy: 'M8 8h12v13H8zM16 8V3H3v13h5', download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
 plus: 'M12 5v14M5 12h14', info: 'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z'
};
export function Icon({ name, size = 20, className = '', style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
 return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}><path d={paths[name]} /></svg>;
}
