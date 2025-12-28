const spiki = (() => {
    const registry = {},
          [metaMap, targetMap, proxyMap] = [new WeakMap(), new WeakMap(), new WeakMap()],
          loopRE = /^\s*(\w+)\s+in\s+(\S+)\s*$/,
          queue = new Set();
          
    let activeEffect, isFlushing, p = Promise.resolve();

    // Helper
    const getValue = (s, path) => {
        if (!path.includes('.')) return s[path];
        return path.split('.').reduce((val, k) => val?.[k], s);
    };
    
    // Scheduler
    const nextTick = fn => !queue.has(fn) && queue.add(fn) && !isFlushing && (isFlushing = true) && 
        p.then(() => (queue.forEach(j => j()), queue.clear(), isFlushing = false));

    // Reactivity
    const track = (t, k) => {
        if (!activeEffect) return;
        let deps = targetMap.get(t);
        if (!deps) targetMap.set(t, (deps = new Map()));
        let dep = deps.get(k);
        if (!dep) deps.set(k, (dep = new Set()));
        dep.add(activeEffect);
        activeEffect.d.add(dep); // .d = deps
    };

    const trigger = (t, k) => {
        const dep = targetMap.get(t)?.get(k);
        if (dep) [...dep].forEach(e => e.x ? e.x(e) : e()); // .x = scheduler
    };

    const cleanup = e => (e.d.forEach(d => d.delete(e)), e.d.clear());

    const effect = (fn, scheduler) => {
        const runner = () => {
            cleanup(runner);
            const prev = activeEffect;
            activeEffect = runner;
            try { fn(); } finally { activeEffect = prev; }
        };
        runner.d = new Set();
        runner.x = scheduler;
        runner();
        return () => cleanup(runner);
    };

    const reactive = (obj) => {
        if (!obj || typeof obj !== 'object' || obj._p || obj instanceof Node) return obj; // ._p = isProxy
        if (proxyMap.has(obj)) return proxyMap.get(obj);

        const proxy = new Proxy(obj, {
            get(t, k, r) {
                if (k === '_p') return true;
                track(t, k);
                const res = Reflect.get(t, k, r);
                if (typeof res === 'object' && res) {
                    if (res instanceof Node) return res; 
                    return reactive(res);
                }
                return res;
            },
            set(t, k, v, r) {
                const old = t[k];
                const hadKey = Array.isArray(t) && !isNaN(parseInt(k)) ? Number(k) < t.length : k in t;
                const res = Reflect.set(t, k, v, r);
                
                if (old !== v || !hadKey) {
                    trigger(t, k);
                    if (Array.isArray(t) && k !== 'length') trigger(t, 'length');
                }
                return res;
            }
        });
        proxyMap.set(obj, proxy);
        return proxy;
    };

    // DOM Ops
    const s = {
        text: (el, v) => el.textContent = v ?? '',
        html: (el, v) => el.innerHTML = v ?? '',
        value: (el, v) => {
            if (el.type === 'checkbox') el.checked = !!v;
            else if (el.type === 'radio' && el.name) el.checked = el.value == v;
            else el.value = v ?? '';
        },
        attr: (el, v, arg) => {
            if (v === false || v === null || v === undefined) el.removeAttribute(arg);
            else el.setAttribute(arg, v === true ? '' : v);
        }
    };

    // Engine
    const mount = (root) => {
        if (root._m) return; 
        root._m = 1;

        const fac = registry[root.getAttribute('s-data')];
        if (!fac) return;

        const state = reactive(fac());
        state.$refs = {}; 
        
        const rootK = []; // .k = cleanups

        const handleEvent = (e) => {
            let t = e.target;
            while (t && t !== root.parentNode) {
                const meta = metaMap.get(t);
                const hn = meta?.[e.type]; // hn = handlerName
                if (hn) {
                    const s = t._s || state; // ._s = scope
                    const fn = getValue(s, hn);
                    if (typeof fn === 'function') fn.call(s, e);
                }
                t = t.parentNode;
            }
        };

        const regFx = (fn, kList) => kList.push(effect(fn, nextTick));

        const walk = (el, scope, k) => {
            if (el.nodeType !== 1) return; 
            if (el.hasAttribute('s-static')) return;
            if (el !== root && el.hasAttribute('s-data')) return;

            let val;

            // s-if
            if (val = el.getAttribute('s-if')) {
                const anchor = document.createTextNode('');
                el.replaceWith(anchor);
                let node, branchK = [];

                regFx(() => {
                    if (getValue(scope, val)) {
                        if (!node) {
                            node = el.cloneNode(true);
                            node.removeAttribute('s-if');
                            walk(node, scope, branchK);
                            anchor.parentNode.insertBefore(node, anchor);
                        }
                    } else if (node) {
                        while (branchK.length) branchK.pop()();
                        node.remove(); 
                        node = null; 
                    }
                }, k);
                return;
            }

            // s-for
            if (el.tagName === 'TEMPLATE' && (val = el.getAttribute('s-for'))) {
                const [, alias, listKey] = val.match(loopRE) || [];
                const anchor = document.createTextNode('');
                el.replaceWith(anchor);

                let pool = new Map();

                regFx(() => {
                    const list = getValue(scope, listKey) || [];
                    const nextPool = new Map();
                    let cursor = anchor;

                    if (Array.isArray(list)) { 
                        list.forEach((item, i) => {
                            const key = (typeof item === 'object' && item !== null) ? item : `${i}_${item}`;
                            let row = pool.get(key);

                            if (!row) {
                                const clone = el.content.cloneNode(true);
                                const itemScope = Object.create(scope);
                                Object.assign(itemScope, { [alias]: item, $index: i, $parent: scope });
                                
                                const nodes = Array.from(clone.childNodes);
                                const rowK = [];
                                
                                nodes.forEach(n => walk(n, itemScope, rowK));
                                row = { n: nodes, s: itemScope, k: rowK };
                            } else {
                                row.s.$index = i;
                                row.s[alias] = item;
                            }

                            if (row.n[0] !== cursor.nextSibling) {
                                const frag = document.createDocumentFragment();
                                row.n.forEach(n => frag.appendChild(n));
                                cursor.parentNode.insertBefore(frag, cursor.nextSibling);
                            }
                            
                            cursor = row.n[row.n.length - 1];
                            nextPool.set(key, row);
                            pool.delete(key);
                        });
                    }
                    
                    pool.forEach(row => {
                        row.k.forEach(stop => stop());
                        row.n.forEach(n => n.remove());
                    });
                    pool = nextPool;
                }, k);
                return;
            }

            // Attributes
            const attrs = Array.from(el.attributes);
            for (const { name, value } of attrs) {
                if (name.startsWith('@')) {
                    const evt = name.slice(1);
                    el._s = scope;
                    let meta = metaMap.get(el);
                    if (!meta) metaMap.set(el, (meta = {}));
                    meta[evt] = value;

                    if (!root._e) root._e = new Set();
                    if (!root._e.has(evt)) {
                        root.addEventListener(evt, handleEvent);
                        root._e.add(evt);
                    }
                } else if (name.startsWith(':')) {
                    regFx(() => s.attr(el, getValue(scope, value), name.slice(1)), k);
                } else if (name.startsWith('s-')) {
                    const dir = name.slice(2);
                    if (dir === 'ref') state.$refs[value] = el;
                    else if (s[dir]) regFx(() => s[dir](el, getValue(scope, value)), k);
                }
            }

            let child = el.firstElementChild;
            while (child) {
                const next = child.nextElementSibling;
                walk(child, scope, k);
                child = next;
            }
        };

        walk(root, state, rootK);
        if (state.init) state.init();

        return { 
            unmount: () => {
                rootK.forEach(stop => stop());
                root._m = 0; // Reset mounted flag
            } 
        };
    };

    return { data: (n, f) => registry[n] = f, start: () => document.querySelectorAll('[s-data]').forEach(mount) };
})();

export default spiki;
