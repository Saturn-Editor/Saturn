import { useEffect, useState } from 'preact/hooks';
// Logo-Light has white lettering (for dark themes); Logo-Dark has dark lettering (for light themes).
import logoOnDarkUrl from '../../../../resources/icons/Logo-Light.png';
import logoOnLightUrl from '../../../../resources/icons/Logo-Dark.png';

/** The Saturn logo, swapping lettering colour with the theme (follows ThemeApplier's `data-theme-type`). */
export function Logo({ class: cls = 'h-20' }: { class?: string }) {
  const read = () => document.documentElement.dataset.themeType ?? 'dark';
  const [type, setType] = useState(read);
  useEffect(() => {
    const update = () => setType(read());
    window.addEventListener('saturn:theme', update);
    return () => window.removeEventListener('saturn:theme', update);
  }, []);
  return <img src={type === 'dark' ? logoOnDarkUrl : logoOnLightUrl} alt="Saturn" class={cls} draggable={false} />;
}
