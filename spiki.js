const spiki = (() => {
    const registry = Object.create(null),
          [metaMap, targetMap, proxyMap] = [new WeakMap(), new WeakMap(), new WeakMap()],
          loopRE = /^\s*(.*?)\s+in\s+(.+)\s*$/,
          queue = new Set();
          
    let activeEffect, isFlushing, p = Promise.resolve();

    // -- 1. Helper --
    const getValue = (root, path, exec = true) => {
        let v = root;
        if (path.includes('.')) {
            for (const part of path.split('.')) {
                v = v?.[part];
                if (v === undefined) return;
            }
        } else {
            v = root[path];
        }
        return (exec && typeof v === 'function') ? v.call(root) : v;
    };
    
    const nextTick = fn => !queue.has(fn) && queue.add(fn) && !isFlushing && (isFlushing = true) && 
        p.then(() => (queue.forEach(j => j()), queue.clear(), isFlushing = false));

    // -- 2. Reactivity --
    const track = (t, k) => {
        if (!activeEffect) return;
        let deps = targetMap.get(t) || targetMap.set(t, new Map()).get(t);
        let dep = deps.get(k) || deps.set(k, new Set()).get(k);
        dep.add(activeEffect);
        activeEffect.d.add(dep);
    };

    const trigger = (t, k) => targetMap.get(t)?.get(k)?.forEach(e => e.x ? e.x(e) : e());

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
        return proxyMap.get(obj) || proxyMap.set(obj, new Proxy(obj, {
            get(t, k, r) {
                if (k === '_p') return true;
                track(t, k);
                const res = Reflect.get(t, k, r);
                return (res && typeof res === 'object' && !(res instanceof Node)) ? reactive(res) : res;
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
        })).get(obj);
    };

    // -- 3. DOM Ops (One-liners) --
    const ops = {
        text: (el, v) => el.textContent = v ?? '',
        html: (el, v) => el.innerHTML = v ?? '',
        class: (el, v) => el.className = (el._oc ??= el.className) + (v ? ' ' + v : ''),
        value: (el, v) => el.type === 'checkbox' ? el.checked = !!v : 
                         (el.type === 'radio' && el.name) ? el.checked = el.value == v : 
                         el.value = v ?? '',
        attr: (el, v, arg) => (v == null || v === false) ? el.removeAttribute(arg) : el.setAttribute(arg, v === true ? '' : v)
    };

    // -- 4. Engine --
    const mount = (root) => {
        if (root._m) return; 
        root._m = 1;

        const fac = registry[root.getAttribute('s-data')];
        if (!fac) return;

        const state = reactive(fac());
        state.$refs = {}; 
        const rootK = [];
        const regFx = (fn, kList) => kList.push(effect(fn, nextTick));

        const handleEvent = (e) => {
            let t = e.target;
            while (t && t !== root.parentNode) {
                const hn = metaMap.get(t)?.[e.type];
                if (hn) {
                    const fn = getValue(t._s || state, hn, false);
                    if (typeof fn === 'function') fn.call(t._s || state, e);
                }
                t = t.parentNode;
            }
        };

        const walk = (el, scope, k) => {
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore') || (el !== root && el.hasAttribute('s-data'))) return;

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
                        branchK.forEach(s => s()); branchK.length = 0; // Optimasi clear array
                        node.remove(); node = null;
                    }
                }, k);
                return;
            }

            // s-for
            if (el.tagName === 'TEMPLATE' && (val = el.getAttribute('s-for'))) {
                const match = val.match(loopRE);
                if (!match) return;

                const [lhs, listKey] = [match[1].replace(/[()]/g, ''), match[2]];
                const [alias, indexAlias] = lhs.split(',').map(s => s.trim());
                
                const anchor = document.createTextNode('');
                el.replaceWith(anchor);
                let pool = new Map();

                regFx(() => {
                    const items = getValue(scope, listKey);
                    const nextPool = new Map();
                    let cursor = anchor;
                    
                    const list = Array.isArray(items) ? items : (items ? Object.keys(items) : []);

                    list.forEach((itemRaw, i) => {
                        const [key, item] = Array.isArray(items) ? [i, itemRaw] : [itemRaw, items[itemRaw]];
                        const rowKey = (typeof item === 'object' && item !== null) ? item : key + '_' + item;
                        let row = pool.get(rowKey);

                        if (!row) {
                            const clone = el.content.cloneNode(true);
                            const s = Object.create(scope);
                            s[alias] = item;
                            if (indexAlias) s[indexAlias] = key; 
                            
                            const n = Array.from(clone.childNodes);
                            const rowK = [];
                            n.forEach(c => walk(c, s, rowK));
                            row = { n, s, k: rowK };
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
                    });
                    
                    pool.forEach(row => (row.k.forEach(s => s()), row.n.forEach(n => n.remove())));
                    pool = nextPool;
                }, k);
                return;
            }

            // Attributes loop
            Array.from(el.attributes).forEach(({ name, value }) => {
                if (name.startsWith(':')) {
                    regFx(() => ops[name.slice(1) === 'class' ? 'class' : 'attr'](el, getValue(scope, value), name.slice(1)), k);
                } else if (name.startsWith('s-')) {
                    const key = name.slice(2);
                    if (key === 'ref') state.$refs[value] = el;
                    else if (ops[key]) regFx(() => ops[key](el, getValue(scope, value)), k);
                    else {
                        el._s = scope;
                        (metaMap.get(el) || metaMap.set(el, {}).get(el))[key] = value;
                        if (!root._e?.has(key)) {
                            (root._e ||= new Set()).add(key);
                            root.addEventListener(key, handleEvent);
                        }
                    }
                }
            });

            // Child Traversal
            let child = el.firstElementChild;
            while (child) {
                walk(child, scope, k);
                child = child.nextElementSibling;
            }
        };

        walk(root, state, rootK);
        if (state.init) state.init();

        return { unmount: () => (rootK.forEach(s => s()), root._m = 0) };
    };

    return { data: (n, f) => registry[n] = f, start: () => document.querySelectorAll('[s-data]').forEach(mount) };
})();

export default spiki;
