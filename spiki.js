const spiki = (() => {
    const registry = Object.create(null),
          [metaMap, targetMap, proxyMap] = [new WeakMap(), new WeakMap(), new WeakMap()],
          loopRE = /^\s*(.*?)\s+in\s+(.+)\s*$/,
          queue = new Set();
          
    let activeEffect, isFlushing, p = Promise.resolve();

    const getValue = (s, path) => {
        if (!path.includes('.')) return s[path];
        const parts = path.split('.');
        for (let i = 0; i < parts.length; i++) {
            s = s?.[parts[i]];
            if (s === undefined) return;
        }
        return s;
    };
    
    const nextTick = fn => !queue.has(fn) && queue.add(fn) && !isFlushing && (isFlushing = true) && 
        p.then(() => (queue.forEach(j => j()), queue.clear(), isFlushing = false));

    const track = (t, k) => {
        if (!activeEffect) return;
        let deps = targetMap.get(t);
        if (!deps) targetMap.set(t, (deps = new Map()));
        let dep = deps.get(k);
        if (!dep) deps.set(k, (dep = new Set()));
        dep.add(activeEffect);
        activeEffect.d.add(dep);
    };

    const trigger = (t, k) => {
        const dep = targetMap.get(t)?.get(k);
        if (dep) [...dep].forEach(e => e.x ? e.x(e) : e());
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
        if (!obj || typeof obj !== 'object' || obj._p || obj instanceof Node) return obj;
        if (proxyMap.has(obj)) return proxyMap.get(obj);

        const proxy = new Proxy(obj, {
            get(t, k, r) {
                if (k === '_p') return true;
                track(t, k);
                const res = Reflect.get(t, k, r);
                return (typeof res === 'object' && res && !(res instanceof Node)) ? reactive(res) : res;
            },
            set(t, k, v, r) {
                const old = t[k];
                const res = Reflect.set(t, k, v, r);
                if (old !== v) {
                    trigger(t, k);
                    if (Array.isArray(t) && k !== 'length') trigger(t, 'length');
                }
                return res;
            }
        });
        proxyMap.set(obj, proxy);
        return proxy;
    };

    const ops = {
        text: (el, v) => el.textContent = v ?? '',
        html: (el, v) => el.innerHTML = v ?? '',
        value: (el, v) => {
            if (el.type === 'checkbox') el.checked = !!v;
            else if (el.type === 'radio' && el.name) el.checked = el.value == v;
            else el.value = v ?? '';
        },
        class: (el, v) => el.className = (el._oc ??= el.className) + (v ? ' ' + v : ''),
        attr: (el, v, arg) => {
            if (v === false || v === null || v === undefined) el.removeAttribute(arg);
            else el.setAttribute(arg, v === true ? '' : v);
        }
    };

    const mount = (root) => {
        if (root._m) return; 
        root._m = 1;

        const fac = registry[root.getAttribute('s-data')];
        if (!fac) return;

        const state = reactive(fac());
        state.$refs = {}; 
        
        const rootK = [];

        const handleEvent = (e) => {
            let t = e.target;
            while (t && t !== root.parentNode) {
                const hn = metaMap.get(t)?.[e.type];
                if (hn) {
                    const s = t._s || state;
                    const fn = getValue(s, hn);
                    if (typeof fn === 'function') fn.call(s, e);
                }
                t = t.parentNode;
            }
        };

        const regFx = (fn, kList) => kList.push(effect(fn, nextTick));

        const walk = (el, scope, k) => {
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore')) return;
            if (el !== root && el.hasAttribute('s-data')) return;

            let val;

            // Structural: s-if
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

            // Structural: s-for
            if (el.tagName === 'TEMPLATE' && (val = el.getAttribute('s-for'))) {
                const match = val.match(loopRE);
                if (!match) return;

                const lhs = match[1].replace(/[()]/g, '');
                const listKey = match[2];
                const [alias, indexAlias] = lhs.split(',').map(s => s.trim());
                
                const anchor = document.createTextNode('');
                el.replaceWith(anchor);
                let pool = new Map();

                regFx(() => {
                    const items = getValue(scope, listKey);
                    const nextPool = new Map();
                    let cursor = anchor;
                    
                    const isArr = Array.isArray(items);
                    const list = isArr ? items : (items ? Object.keys(items) : []);

                    for (let i = 0; i < list.length; i++) {
                        const key = isArr ? i : list[i];
                        const item = isArr ? list[i] : items[key];

                        const rowKey = (typeof item === 'object' && item !== null) ? item : key + '_' + item;
                        let row = pool.get(rowKey);

                        if (!row) {
                            const clone = el.content.cloneNode(true);
                            const itemScope = Object.create(scope);
                            itemScope[alias] = item;
                            if (indexAlias) itemScope[indexAlias] = key; 
                            
                            const nodes = Array.from(clone.childNodes);
                            const rowK = [];
                            
                            for(let n = 0; n < nodes.length; n++) walk(nodes[n], itemScope, rowK);
                            row = { n: nodes, s: itemScope, k: rowK };
                        } else {
                            row.s[alias] = item;
                            if (indexAlias) row.s[indexAlias] = key;
                        }

                        if (row.n[0] !== cursor.nextSibling) {
                            const frag = document.createDocumentFragment();
                            row.n.forEach(n => frag.appendChild(n));
                            cursor.parentNode.insertBefore(frag, cursor.nextSibling);
                        }
                        
                        cursor = row.n[row.n.length - 1];
                        nextPool.set(rowKey, row);
                        pool.delete(rowKey);
                    }
                    
                    pool.forEach(row => {
                        row.k.forEach(stop => stop());
                        row.n.forEach(n => n.remove());
                    });
                    pool = nextPool;
                }, k);
                return;
            }

            // Attributes: Binding (:) and Combined s- (Directive/Event)
            const attrs = el.attributes;
            for (let i = attrs.length - 1; i >= 0; i--) {
                const { name, value } = attrs[i];
                
                if (name.startsWith(':')) {
                    const arg = name.slice(1);
                    const handler = arg === 'class' ? ops.class : ops.attr;
                    regFx(() => handler(el, getValue(scope, value), arg), k);

                } else if (name.startsWith('s-')) {
                    const key = name.slice(2); // Remove 's-'

                    if (key === 'ref') {
                        state.$refs[value] = el;
                    } else if (ops[key]) {
                        regFx(() => ops[key](el, getValue(scope, value)), k);
                    } else {
                        // Fallback to Event (s-click, s-input)
                        el._s = scope;
                        let meta = metaMap.get(el);
                        if (!meta) metaMap.set(el, (meta = {}));
                        meta[key] = value;

                        if (!root._e) (root._e = new Set());
                        if (!root._e.has(key)) {
                            root.addEventListener(key, handleEvent);
                            root._e.add(key);
                        }
                    }
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
                root._m = 0; 
            } 
        };
    };

    return { 
        data: (n, f) => registry[n] = f, 
        start: () => document.querySelectorAll('[s-data]').forEach(mount) 
    };
})();

export default spiki;
