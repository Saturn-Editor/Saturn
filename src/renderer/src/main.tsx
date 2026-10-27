import { render, type ComponentType } from 'preact';
import type { WindowKind } from '@shared/types';
import { EditorScreen } from './screens/editor/EditorScreen';
import { MarketplaceScreen } from './screens/MarketplaceScreen';
import { NewProjectScreen } from './screens/NewProjectScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { CredentialPrompt } from './screens/CredentialPrompt';
import { ThemeApplier } from './theme/ThemeApplier';
import { followKeymap } from './commands/keymap';
import './styles.css';

// Each window shows its screen with no props (Settings and Marketplace default to their own-window layout).
const screens: Record<WindowKind, ComponentType<any>> = {
  welcome: WelcomeScreen,
  editor: EditorScreen,
  settings: SettingsScreen,
  'new-project': NewProjectScreen,
  marketplace: MarketplaceScreen,
  onboarding: OnboardingScreen,
};

// Apply the theme before the first render so there's no flash of unstyled colours.
await new ThemeApplier().follow();
await followKeymap();
const Screen = screens[window.saturn.window.kind];
// Any window can be asked for Git credentials (a clone from Welcome, a push from an editor).
render(<><Screen /><CredentialPrompt /></>, document.getElementById('app')!);
