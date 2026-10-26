import type { JSX } from 'preact';

type IconProps = { class?: string };

function Svg({ class: cls = 'size-4', children }: IconProps & { children: JSX.Element | JSX.Element[] }) {
  return (
    <svg class={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="square" aria-hidden="true">
      {children}
    </svg>
  );
}

export const FolderIcon = (p: IconProps) => <Svg {...p}><path d="M1.5 3.5h5l1.5 1.5h6.5v8h-13z" /></Svg>;
export const TerminalIcon = (p: IconProps) => <Svg {...p}><path d="M1.5 2.5h13v11h-13z M4 6l2.5 2L4 10 M8 10.5h4" /></Svg>;
export const CommitIcon = (p: IconProps) => <Svg {...p}><path d="M3 8.5l3 3 7-7" /></Svg>;
export const GitIcon = (p: IconProps) => <Svg {...p}><path d="M5 2v12 M5 6c0 3 6 1 6 5 M11 11v3 M11 2v4" /></Svg>;
export const PlayIcon = (p: IconProps) => <Svg {...p}><path d="M4.5 2.5l9 5.5-9 5.5z" fill="currentColor" /></Svg>;
export const StopIcon = (p: IconProps) => <Svg {...p}><path d="M3.5 3.5h9v9h-9z" fill="currentColor" /></Svg>;
export const GearIcon = (p: IconProps) => <Svg {...p}><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M8 1v2 M8 13v2 M1 8h2 M13 8h2 M3 3l1.5 1.5 M11.5 11.5L13 13 M3 13l1.5-1.5 M11.5 4.5L13 3" /></Svg>;
export const PlusIcon = (p: IconProps) => <Svg {...p}><path d="M8 3v10 M3 8h10" /></Svg>;
export const MoreIcon = (p: IconProps) => <Svg {...p}><path d="M3 8h.5 M8 8h.5 M13 8h.5" stroke-width="2" /></Svg>;
export const CloseIcon = (p: IconProps) => <Svg {...p}><path d="M4 4l8 8 M12 4l-8 8" /></Svg>;
export const ChevronDownIcon = (p: IconProps) => <Svg {...p}><path d="M4 6l4 4 4-4" /></Svg>;
export const ChevronRightIcon = (p: IconProps) => <Svg {...p}><path d="M6 4l4 4-4 4" /></Svg>;
export const SearchIcon = (p: IconProps) => <Svg {...p}><path d="M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.5 10.5l3.5 3.5" /></Svg>;
export const CodeIcon = (p: IconProps) => <Svg {...p}><path d="M5.5 4L2 8l3.5 4 M10.5 4L14 8l-3.5 4" /></Svg>;
export const SplitIcon = (p: IconProps) => <Svg {...p}><path d="M1.5 2.5h13v11h-13z M8 2.5v11" /></Svg>;
export const PreviewIcon = (p: IconProps) => <Svg {...p}><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" /></Svg>;
export const FileIcon = (p: IconProps) => <Svg {...p}><path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3" /></Svg>;
