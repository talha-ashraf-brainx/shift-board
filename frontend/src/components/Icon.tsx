import type { SVGProps } from 'react';

export type IconName =
  | 'plus'
  | 'gear'
  | 'close'
  | 'chevron-right'
  | 'chevron-down'
  | 'alert'
  | 'check'
  | 'question'
  | 'reply'
  | 'arrow-swap'
  | 'sparkle'
  | 'x-circle'
  | 'merge'
  | 'terminal'
  | 'edit'
  | 'refresh'
  | 'file'
  | 'dot'
  | 'wifi-off'
  | 'folder'
  | 'arrow-up'
  | 'trash'
  | 'branch'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'image';

const PATHS: Record<IconName, string> = {
  plus: 'M8 3.5v9M3.5 8h9',
  gear: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM13 8a5 5 0 0 0-.1-1l1.4-1.1-1.3-2.2-1.7.6a5 5 0 0 0-1.7-1L9.3 1.5H6.7l-.3 1.8a5 5 0 0 0-1.7 1L3 3.7 1.7 5.9 3.1 7a5 5 0 0 0 0 2l-1.4 1.1L3 12.3l1.7-.6a5 5 0 0 0 1.7 1l.3 1.8h2.6l.3-1.8a5 5 0 0 0 1.7-1l1.7.6 1.3-2.2L12.9 9c.1-.3.1-.7.1-1Z',
  close: 'M4 4l8 8M12 4l-8 8',
  'chevron-right': 'M6 3.5 10.5 8 6 12.5',
  'chevron-down': 'M3.5 6 8 10.5 12.5 6',
  alert: 'M8 2.5 14.5 13.5h-13L8 2.5ZM8 6.5v3M8 11.5v.01',
  check: 'M3 8.5 6.5 12 13 4.5',
  question: 'M6 6a2 2 0 1 1 2.8 1.8c-.5.3-.8.7-.8 1.2v.5M8 11.5v.01M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z',
  reply: 'M6.5 4 2.5 8l4 4M2.5 8h7a4 4 0 0 1 4 4v.5',
  'arrow-swap': 'M2.5 5.5h10l-2.5-2.5M13.5 10.5h-10l2.5 2.5',
  sparkle: 'M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8l5.1-1.4L8 1.5Z',
  'x-circle': 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4',
  merge: 'M4.5 2.5v11M4.5 5.5c0 3 7 2 7 6M11.5 13.5v-2',
  terminal: 'M2.5 3.5h11v9h-11zM4.5 6.5 6.5 8l-2 1.5M8 10h3',
  edit: 'M10.5 2.5l3 3L6 13H3v-3l7.5-7.5Z',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3',
  file: 'M4 1.5h5l3.5 3.5v9.5H4zM9 1.5V5h3.5',
  dot: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  'wifi-off': 'M2 2l12 12M5.5 11.5a3.5 3.5 0 0 1 5 0M3 8.5a7 7 0 0 1 3-1.7M13 8.5a7 7 0 0 0-2.4-1.5M8 13.5v.01',
  folder: 'M1.5 4a1 1 0 0 1 1-1h3.6l1.5 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4Z',
  'arrow-up': 'M8 13V3M3.5 7.5 8 3l4.5 4.5',
  trash: 'M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.8 7v4.5M9.2 7v4.5',
  branch: 'M5 2.5v11M11 2.5v2.5c0 3-6 2.5-6 6',
  sun: 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1',
  moon: 'M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z',
  monitor: 'M2 3h12v8H2zM5.5 14h5M8 11v3',
  image: 'M2.5 3h11v10h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6v.01',
};

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      width="16"
      height="16"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
