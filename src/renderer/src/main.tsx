import { render, type ComponentType } from 'preact';
import type { WindowKind } from '@shared/types';
import { EditorScreen } from './screens/editor/EditorScreen';
import { MarketplaceScreen } from './screens/marketplace/MarketplaceScreen';
import { NewProjectScreen } from './screens/newProject/NewProjectScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { WelcomeScreen } from './screens/welcome/WelcomeScreen';
import { ThemeApplier } from './theme/ThemeApplier';
import './styles.css';

const screens: Record<WindowKind, ComponentType> = {
  welcome: WelcomeScreen,
  editor: EditorScreen,
  settings: SettingsScreen,
  'new-project': NewProjectScreen,
  marketplace: MarketplaceScreen,
};

// Apply the theme before the first render so there's no flash of unstyled colours.
await new ThemeApplier().follow();
const Screen = screens[window.saturn.window.kind];
render(<Screen />, document.getElementById('app')!);
