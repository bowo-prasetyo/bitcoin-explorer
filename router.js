import Home from './components/Home.js';
import BlockView from './components/BlockView.js';
import TxView from './components/TxView.js';
import AddressView from './components/AddressView.js';
import ChartsView from './components/ChartsView.js';
import ProvidersView from './components/ProvidersView.js';
import GlossaryView from './components/GlossaryView.js';
import NotFound from './components/NotFound.js';
import { titleFor } from './titles.js';

const router = VueRouter.createRouter({
  history: VueRouter.createWebHashHistory(),

  routes: [
    { path: '/', component: Home },
    { path: '/block/:hash', component: BlockView },
    { path: '/tx/:txid', component: TxView },
    { path: '/address/:addr', component: AddressView },
    { path: '/charts', component: ChartsView },
    { path: '/providers', component: ProvidersView },
    { path: '/glossary', component: GlossaryView },
    { path: '/:unknown(.*)*', component: NotFound }
  ]
});

// A title per page, so tabs and history can be told apart. Views may
// refine it once their data loads (e.g. a block's height).
router.afterEach(to => {
  document.title = titleFor(to);
});

export default router;
