import Home from './components/Home.js';
import BlockView from './components/BlockView.js';
import TxView from './components/TxView.js';
import AddressView from './components/AddressView.js';
import ChartsView from './components/ChartsView.js';

export default VueRouter.createRouter({
  history: VueRouter.createWebHashHistory(),

  routes: [
    { path: '/', component: Home },
    { path: '/block/:hash', component: BlockView },
    { path: '/tx/:txid', component: TxView },
    { path: '/address/:addr', component: AddressView },
    { path: '/charts', component: ChartsView }
  ]
});
