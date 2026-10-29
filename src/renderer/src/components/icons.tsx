// The SVGs live in resources/icons/ so they can be edited directly. Use stroke="currentColor"
// (or fill) in them so icons follow the theme's text colours.
import bell from '../../../../resources/icons/bell.svg?raw';
import chevronDown from '../../../../resources/icons/chevron-down.svg?raw';
import chevronRight from '../../../../resources/icons/chevron-right.svg?raw';
import close from '../../../../resources/icons/close.svg?raw';
import code from '../../../../resources/icons/code.svg?raw';
import commit from '../../../../resources/icons/commit.svg?raw';
import file from '../../../../resources/icons/file.svg?raw';
import folder from '../../../../resources/icons/folder.svg?raw';
import gear from '../../../../resources/icons/gear.svg?raw';
import git from '../../../../resources/icons/git.svg?raw';
import more from '../../../../resources/icons/more.svg?raw';
import play from '../../../../resources/icons/play.svg?raw';
import notices from '../../../../resources/icons/notices.svg?raw';
import plus from '../../../../resources/icons/plus.svg?raw';
import preview from '../../../../resources/icons/preview.svg?raw';
import question from '../../../../resources/icons/question.svg?raw';
import search from '../../../../resources/icons/search.svg?raw';
import split from '../../../../resources/icons/split.svg?raw';
import stop from '../../../../resources/icons/stop.svg?raw';
import terminal from '../../../../resources/icons/terminal.svg?raw';
import outline from '../../../../resources/icons/outline.svg?raw';
import usages from '../../../../resources/icons/usages.svg?raw';
import testsIcon from '../../../../resources/icons/tests.svg?raw';
import debug from '../../../../resources/icons/debug.svg?raw';
import stepOver from '../../../../resources/icons/step-over.svg?raw';
import stepInto from '../../../../resources/icons/step-into.svg?raw';
import stepOut from '../../../../resources/icons/step-out.svg?raw';
import continueRun from '../../../../resources/icons/continue.svg?raw';
import pause from '../../../../resources/icons/pause.svg?raw';
import expandAll from '../../../../resources/icons/expand-all.svg?raw';
import collapseAll from '../../../../resources/icons/collapse-all.svg?raw';
import refresh from '../../../../resources/icons/refresh.svg?raw';

type IconProps = { class?: string };

/** An icon component for one SVG file, sized by its `class` (size-4 by default). */
function svgIcon(markup: string) {
  // The SVG fills the span, so the span's size classes set the icon's size.
  const filled = markup.replace('<svg', '<svg width="100%" height="100%" aria-hidden="true"');
  return ({ class: cls = 'size-4' }: IconProps) => (
    <span class={`inline-flex shrink-0 ${cls}`} dangerouslySetInnerHTML={{ __html: filled }} />
  );
}

export const BellIcon = svgIcon(bell);
export const NoticesIcon = svgIcon(notices);
export const FolderIcon = svgIcon(folder);
export const TerminalIcon = svgIcon(terminal);
export const CommitIcon = svgIcon(commit);
export const GitIcon = svgIcon(git);
export const PlayIcon = svgIcon(play);
export const StopIcon = svgIcon(stop);
export const GearIcon = svgIcon(gear);
export const PlusIcon = svgIcon(plus);
export const MoreIcon = svgIcon(more);
export const CloseIcon = svgIcon(close);
export const ChevronDownIcon = svgIcon(chevronDown);
export const ChevronRightIcon = svgIcon(chevronRight);
export const SearchIcon = svgIcon(search);
export const CodeIcon = svgIcon(code);
export const SplitIcon = svgIcon(split);
export const PreviewIcon = svgIcon(preview);
export const FileIcon = svgIcon(file);
/** Shown for a module's panel or button that has no icon. */
export const OutlineIcon = svgIcon(outline);
export const UsagesIcon = svgIcon(usages);
export const TestsIcon = svgIcon(testsIcon);
export const DebugIcon = svgIcon(debug);
export const StepOverIcon = svgIcon(stepOver);
export const StepIntoIcon = svgIcon(stepInto);
export const StepOutIcon = svgIcon(stepOut);
export const ContinueIcon = svgIcon(continueRun);
export const PauseIcon = svgIcon(pause);
export const ExpandAllIcon = svgIcon(expandAll);
export const CollapseAllIcon = svgIcon(collapseAll);
export const RefreshIcon = svgIcon(refresh);
export const QuestionIcon = svgIcon(question);
