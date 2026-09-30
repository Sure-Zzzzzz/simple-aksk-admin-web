import { createApp, type App as VueApp } from 'vue';
import '@sure-zzzzzz/simple-iam-theme-contract/theme.css';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { qiankunWindow, renderWithQiankun } from 'vite-plugin-qiankun/dist/helper';
import App from './App.vue';
import { applyAkskBridge, akskState, type AkskMountProps } from './akskState';
import { applyAkskTheme, createLightAkskThemeSnapshot } from './akskTheme';
import { setAkskUnauthorizedTargetProvider } from './api/akskAuth';
import { cancelAkskTokenRenewal } from './auth/pkce';
import type { ThemeSnapshot } from '@sure-zzzzzz/simple-iam-theme-contract';
import ClientsView from './view/ClientsView.vue';
import CreateClientView from './view/CreateClientView.vue';
import ClientDetailView from './view/ClientDetailView.vue';
import TokensView from './view/TokensView.vue';
import AuthorizationsView from './view/AuthorizationsView.vue';
import AuthorizationEditorView from './view/AuthorizationEditorView.vue';
import StandaloneGuideView from './view/StandaloneGuideView.vue';
import OAuthCallbackView from './view/OAuthCallbackView.vue';
import ForbiddenView from './view/ForbiddenView.vue';
import MyCredentialsView from './view/MyCredentialsView.vue';
import './style.css';

let app: VueApp<Element> | null = null;
let router: Router | null = null;
let currentThemeSnapshot = createLightAkskThemeSnapshot();
let releaseThemeSubscription: () => void = () => undefined;

interface MountProps extends AkskMountProps {
  container?: Element | Document;
  routePrefix?: string;
  theme?: { current(): ThemeSnapshot; subscribe(listener: (value: ThemeSnapshot) => void): () => void };
}

function createAkskRouter(base: string) {
  const instance = createRouter({
    history: createWebHistory(base),
    routes: [
      { path: '/', component: StandaloneGuideView },
      { path: '/clients', component: ClientsView },
      { path: '/my-credentials', component: MyCredentialsView },
      { path: '/clients/create', component: CreateClientView },
      { path: '/clients/:clientId', component: ClientDetailView },
      { path: '/tokens', component: TokensView },
      { path: '/authorizations', component: AuthorizationsView },
      { path: '/authorizations/:clientId', component: AuthorizationEditorView },
      { path: '/oauth-callback', component: OAuthCallbackView },
      { path: '/403', name: 'forbidden', component: ForbiddenView },
      { path: '/:pathMatch(.*)*', redirect: '/my-credentials' }
    ]
  });
  instance.beforeEach(to => {
    if (!akskState.bridge) {
      return true;
    }
    const adminOnly = to.path === '/clients'
      || to.path.startsWith('/clients/')
      || to.path === '/tokens'
      || to.path === '/authorizations'
      || to.path.startsWith('/authorizations/');
    if (to.path === '/' || (!akskState.currentUser?.admin && adminOnly)) {
      return { path: akskState.currentUser?.admin ? '/clients' : '/my-credentials' };
    }
    return true;
  });
  return instance;
}

function applyHostTheme(root: HTMLElement, props: MountProps, subscribe = true) {
  if (props.theme) {
    currentThemeSnapshot = props.theme.current();
  }
  applyAkskTheme(root, currentThemeSnapshot);
  if (!subscribe || !props.theme) {
    return;
  }
  releaseThemeSubscription();
  releaseThemeSubscription = props.theme.subscribe(nextSnapshot => {
    currentThemeSnapshot = nextSnapshot;
    applyAkskTheme(root, currentThemeSnapshot);
  });
}

function render(props: MountProps = {}) {
  applyAkskBridge(props);
  router = createAkskRouter(qiankunWindow.__POWERED_BY_QIANKUN__
    ? `${props.routePrefix || '/app/aksk'}/`
    : '/app/aksk/');
  setAkskUnauthorizedTargetProvider(() => (router ? router.currentRoute.value.fullPath : '/'));
  app = createApp(App);
  app.use(router);
  const container = props.container?.querySelector('#app') || document.querySelector('#app');
  if (container instanceof HTMLElement) {
    app.mount(container);
    const root = container.querySelector<HTMLElement>('.aksk-admin-app');
    if (root) {
      applyHostTheme(root, props);
    }
  }
}

renderWithQiankun({
  bootstrap() {},
  mount(props) {
    render(props as MountProps);
  },
  unmount() {
    releaseThemeSubscription();
    releaseThemeSubscription = () => undefined;
    cancelAkskTokenRenewal();
    app?.unmount();
    app = null;
    router = null;
    currentThemeSnapshot = createLightAkskThemeSnapshot();
    applyAkskBridge();
  },
  update(props) {
    const mountProps = props as MountProps;
    applyAkskBridge(mountProps);
    const container = mountProps.container?.querySelector('#app') || document.querySelector('#app');
    const root = container instanceof HTMLElement ? container.querySelector<HTMLElement>('.aksk-admin-app') : null;
    if (root) {
      applyHostTheme(root, mountProps, Boolean(mountProps.theme));
    }
  }
});

if (!qiankunWindow.__POWERED_BY_QIANKUN__) {
  render();
}
