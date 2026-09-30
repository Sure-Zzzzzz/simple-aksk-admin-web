import { reactive } from 'vue';
import type { RuntimeContext, Subscription } from '@sure-zzzzzz/simple-frontend-contract';
import type { ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';
import { setAkskApiBase } from './api/akskAuth';

export interface AkskPortalUser {
  /** IAM 对外稳定主体 ID；不得传递或依赖内部自增 userId。 */
  subjectId: string | null;
  username: string;
  displayName: string | null;
  admin: boolean;
  authorities: string[];
}

export interface AkskBridge extends RuntimeContext {
  getCurrentUser?: () => AkskPortalUser | null;
  currentUser?: AkskPortalUser | null;
  onUnauthorized?: () => void;
  theme?: Subscription<ThemeSnapshot>;
  routePrefix?: string;
}

export interface AkskMountProps extends Partial<AkskBridge> {
  apiBase?: string | null;
}

export const akskState = reactive({
  currentUser: null as AkskPortalUser | null,
  bridge: null as AkskBridge | null,
  apiBase: ''
});

export function applyAkskBridge(props?: AkskMountProps) {
  akskState.bridge = props?.getCurrentUser ? props as AkskBridge : null;
  akskState.apiBase = typeof props?.apiBase === 'string' ? props.apiBase.replace(/\/+$/, '') : '';
  setAkskApiBase(akskState.apiBase);
  akskState.currentUser = props?.getCurrentUser?.() || props?.currentUser || null;
}
