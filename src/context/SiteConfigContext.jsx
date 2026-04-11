import { createContext, useContext } from 'react';

export const SiteConfigContext = createContext(null);

export function useSiteConfig() {
  return useContext(SiteConfigContext);
}
