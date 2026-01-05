const spiki = (() => {
    const registry = Object.create(null),
          [metaMap, targetMap, proxyMap] = [new WeakMap(), new WeakMap(), new WeakMap()],
          pathCache = new Map(),
          loopRE = /^\s*(.*?)\s+in\s+(.+)\s*$/,
          queue = new Set();
          
    let activeEffect, isFlushing, p = Promise.resolve(), globalStore;
    
    let shouldTrigger = true; 

    const arrayInstrumentations = {};
    ['sort', 'reverse', 'splice'].forEach(method => {
        const original = Array.prototype[method];
        arrayInstrumentations[method] = function(...args) {
            shouldTrigger = false; 
            const res = original.apply(this, args);
            shouldTrigger = true;
            trigger(this, 'length');
            return res;
        };
    });

    // 1. Helpers
    const getValue = (root, path, arg, exec = true) => {
        if (path.indexOf('.') === -1) {
            const v = root[path];
            return (exec && typeof v === 'function') ? v.call(root, arg) : v;
        }
        
        let parts = pathCache.get(path);
        if (!parts) {
            pathCache.set(path, (parts = path.split('.')));
        }
        
        let v = root;
        for (const p of parts) if ((v = v?.[p]) === undefined) return;
        return (exec && typeof v === 'function') ? v.call(root, arg) : v;
    };
    
    // 2. Scheduler
    const nextTick = fn => !queue.has(fn) && queue.add(fn) && !isFlushing && (isFlushing = true) && 
        p.then(() => (queue.forEach(j => j()), queue.clear(), isFlushing = false));

    // 3. Reactivity System
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
        if (!shouldTrigger) return;
        targetMap.get(t)?.get(k)?.forEach(e => e.x ? e.x(e) : e());
    };

    const effect = (fn, scheduler) => {
        const runner = () => {
            runner.d.forEach(d => d.delete(runner)); runner.d.clear();
            const prev = activeEffect;
            activeEffect = runner;
            try { fn(); } finally { activeEffect = prev; }
        };
        runner.d = new Set();
        runner.x = scheduler;
        runner();
        
        return () => {
            runner.d.forEach(d => d.delete(runner)); 
            runner.d.clear();
            queue.delete(runner);
        };
    };

    const reactive = (obj) => {
        if (!obj || typeof obj !== 'object' || obj._p || obj instanceof Node) return obj;
        return proxyMap.get(obj) || proxyMap.set(obj, new Proxy(obj, {
            get: (t, k, r) => {
                if (k === '_p') return true;
                if (Array.isArray(t) && arrayInstrumentations.hasOwnProperty(k)) return arrayInstrumentations[k];
                track(t, k);
                const res = Reflect.get(t, k, r);
                return (res && typeof res === 'object' && !(res instanceof Node)) ? reactive(res) : res;
            },
            set: (t, k, v, r) => {
                const old = t[k];
                const hadKey = Array.isArray(t) ? Number(k) < t.length : Object.prototype.hasOwnProperty.call(t, k);
                const res = Reflect.set(t, k, v, r);

                if (shouldTrigger) {
                    if (!hadKey) {
                        trigger(t, k);
                        if (Array.isArray(t)) trigger(t, 'length');
                    } else if (old !== v) {
                        trigger(t, k);
                    }
                }
                return res;
            }
        })).get(obj);
    };

    globalStore = reactive({});

    // 4. DOM Operations
    const ops = {
        text: (el, v) => el.textContent = v ?? '',
        html: (el, v) => el.innerHTML = v ?? '',
        value: (el, v) => {
            if (el.type === 'checkbox') el.checked = !!v;
            else if (el.type === 'radio' && el.name) el.checked = el.value == v;
            else if (el.value != v) el.value = v ?? '';
        },
        attr: (el, v, arg) => (v == null || v === false) ? el.removeAttribute(arg) : el.setAttribute(arg, v === true ? '' : v),
        class: (el, v) => typeof v === 'string' && v.split(/\s+/).forEach(c => c && (c[0] === '!' ? el.classList.remove(c.slice(1)) : el.classList.add(c))),
        init: () => {}, destroy: () => {}
    };

    // 5. Engine
    const mount = (root) => {
        if (root._m) return; root._m = 1;
        const fac = registry[root.getAttribute('s-data')];
        if (!fac) return;

        const state = reactive(fac());
        state.$refs = {};
        state.$root = root;
        state.$store = globalStore; 
        
        const regFx = (fn, kList) => kList.push(effect(fn, nextTick));

        const handleEvent = (e) => {
            let t = e.target;
            if (t._m && (e.type === 'input' || e.type === 'change')) {
                const scope = t._s || state;
                const path = t._m;
                const v = t.type === 'checkbox' ? t.checked : t.value;
                if (path.indexOf('.') > -1) {
                    const parts = pathCache.get(path) || path.split('.');
                    if (!pathCache.has(path)) pathCache.set(path, parts);
                    let target = scope;
                    for(let i=0; i<parts.length-1; i++) target = target[parts[i]];
                    target[parts[parts.length-1]] = v;
                } else scope[path] = v;
            }
            
            let hn;
            while (t && t !== root.parentNode) {
                if (hn = metaMap.get(t)?.[e.type]) {
                    const fn = getValue(t._s || state, hn, null, false);
                    if (typeof fn === 'function') fn.call(t._s || state, e);
                }
                t = t.parentNode;
            }
        };

        const walk = (el, scope, kList) => {
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore')) return;
            if (el !== root && el.hasAttribute('s-data')) {
                const child = mount(el);
                if (child) kList.push(child.unmount);
                return;
            }

            let val;
            // s-if
            if (val = el.getAttribute('s-if')) {
                const anchor = document.createTextNode(''), branchK = [];
                el.replaceWith(anchor);
                let node;
                return regFx(() => {
                    if (getValue(scope, val)) {
                        if (!node) {
                            node = el.cloneNode(true);
                            node.removeAttribute('s-if');
                            walk(node, scope, branchK);
                            anchor.parentNode.insertBefore(node, anchor);
                        }
                    } else if (node) {
                        branchK.forEach(s => s()); branchK.length = 0;
                        node.remove(); node = null;
                    }
                }, kList);
            }

            // s-for
            if (el.tagName === 'TEMPLATE' && (val = el.getAttribute('s-for'))) {
                const match = val.match(loopRE);
                if (!match) return;
                const [lhs, listKey] = [match[1].replace(/[()]/g, ''), match[2]];
                const [alias, idx] = lhs.split(',').map(s => s.trim());
                const anchor = document.createTextNode('');
                el.replaceWith(anchor);
                let pool = new Map();

                return regFx(() => {
                    const items = getValue(scope, listKey), nextPool = new Map();
                    if (Array.isArray(items)) track(items, 'length');

                    let cursor = anchor;
                    const list = Array.isArray(items) ? items : (items ? Object.keys(items) : []);

                    list.forEach((raw, i) => {
                        const [key, item] = Array.isArray(items) ? [i, raw] : [raw, items[raw]];
                        const rowKey = (typeof item === 'object' && item) ? item : key + '_' + item;
                        let row = pool.get(rowKey);

                        if (!row) {
                            const clone = el.content.cloneNode(true), s = Object.create(scope), rowK = [];
                            s[alias] = item; if (idx) s[idx] = key;
                            const nodes = [];
                            let c = clone.firstChild;
                            while (c) {
                                nodes.push(c);
                                const next = c.nextSibling;
                                walk(c, s, rowK);
                                c = next;
                            }
                            row = { n: nodes, s, k: rowK }; 
                        } else {
                            row.s[alias] = item; if (idx) row.s[idx] = key;
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
                }, kList);
            }

            const attrs = el.attributes;
            for (let i = attrs.length - 1; i >= 0; i--) {
                const { name, value } = attrs[i];
                const prefix = name[0];

                if (prefix === ':') {
                    const attr = name.slice(1);
                    regFx(() => ops[attr === 'class' ? 'class' : 'attr'](el, getValue(scope, value, el), attr), kList);
                } 
                else if (prefix === 's' && name[1] === '-') {
                    const type = name.slice(2);
                    if (type === 'ref') state.$refs[value] = el;
                    else if (type === 'model') {
                        regFx(() => ops.value(el, getValue(scope, value, el)), kList);
                        const tag = el.tagName;
                        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
                            el._s = scope; el._m = value; 
                            const evt = (el.type === 'checkbox' || el.type === 'radio' || tag === 'SELECT') ? 'change' : 'input';
                            if (!root._e?.has(evt)) {
                                (root._e ??= new Set()).add(evt);
                                root.addEventListener(evt, handleEvent);
                            }
                        }
                    }
                    else if (ops[type]) {
                        regFx(() => ops[type](el, getValue(scope, value, el)), kList);
                    }
                    else { 
                        el._s = scope;
                        (metaMap.get(el) ?? metaMap.set(el, {}).get(el))[type] = value;
                        if (!root._e?.has(type)) {
                            (root._e ??= new Set()).add(type);
                            root.addEventListener(type, handleEvent);
                        }
                    }
                }
            }

            let child = el.firstElementChild;
            while (child) {
                const next = child.nextElementSibling;
                walk(child, scope, kList);
                child = next;
            }
        };

        const rootK = [];
        walk(root, state, rootK);
        if (state.init) state.init();
        
        return { 
            unmount: () => {
                if (state.destroy) state.destroy.call(state); 
                rootK.forEach(s => s()); 
                root._e?.forEach(k => root.removeEventListener(k, handleEvent));
                root._m = 0;
            } 
        };
    };

    return { 
        data: (n, f) => registry[n] = f, 
        start: () => document.querySelectorAll('[s-data]').forEach(mount),
        store: (key, val) => {
            if (val === undefined) return globalStore[key];
            globalStore[key] = val;
            return globalStore[key];
        }
    };
})();

export default spiki;
