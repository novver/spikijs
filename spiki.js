const spiki = (() => {
    const registry = Object.create(null),
        [metaMap, targetMap, proxyMap] = [new WeakMap(), new WeakMap(), new WeakMap()],
        pathCache = new Map(),
        queue = new Set(),
        loopRE = /^\s*(.*?)\s+in\s+(.+)\s*$/;

    let activeEffect, isFlushing, globalStore, shouldTrigger = true, p = Promise.resolve();

    // 1. Array Interceptors
    const arrayInstrumentations = {};
    ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].forEach(m =>
        arrayInstrumentations[m] = function (...args) {
            shouldTrigger = false;
            try {
                const res = Array.prototype[m].apply(this, args);
                return res;
            } finally {
                shouldTrigger = true;
                trigger(this, 'length');
            }
        }
    );

    // 2. Helpers
    const createScope = (parent) => {
        const proto = Object.create(parent);
        return new Proxy(proto, {
            set: (target, key, value, receiver) => {
                if (target.hasOwnProperty(key)) return Reflect.set(target, key, value, receiver);
                let cursor = target;
                while (cursor && !Object.prototype.hasOwnProperty.call(cursor, key)) {
                    cursor = Object.getPrototypeOf(cursor);
                }
                return Reflect.set(cursor || target, key, value);
            }
        });
    };

    // Not write logic in HTML
    const evaluate = (scope, path) => {
        if (typeof path !== 'string') return { val: path, ctx: scope };
        let parts = pathCache.get(path);
        if (!parts){
            if (pathCache.size > 1000) pathCache.clear();
            pathCache.set(path, (parts = path.split('.')));
        }
            
        let val = scope, ctx = scope;
        for (const part of parts) {
            if (val == null) {
                return { val, ctx: null }; 
            }
            ctx = val;
            val = val[part];
        }
        return { val, ctx };
    };

    const nextTick = fn => !queue.has(fn) && queue.add(fn) && !isFlushing && (isFlushing = true) &&
        p.then(() => (queue.forEach(j => j()), queue.clear(), isFlushing = false));

    // 3. Reactivity
    const track = (t, k) => {
        if (!activeEffect) return;
        let deps = targetMap.get(t) ?? targetMap.set(t, new Map()).get(t);
        let dep = deps.get(k) ?? deps.set(k, new Set()).get(k);
        dep.add(activeEffect);
        activeEffect.d.add(dep);
    };

    const trigger = (t, k) => shouldTrigger && targetMap.get(t)?.get(k)?.forEach(e => e.x ? e.x(e) : e());

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
        return () => (runner.d.forEach(d => d.delete(runner)), runner.d.clear(), queue.delete(runner));
    };

    const reactive = (obj) => {
        if (!obj || typeof obj !== 'object' || obj._p || obj instanceof Node) return obj;
        return proxyMap.get(obj) || proxyMap.set(obj, new Proxy(obj, {
            get: (t, k, r) => {
                if (k === '_p') return true;
                if (Array.isArray(t) && arrayInstrumentations.hasOwnProperty(k)) return arrayInstrumentations[k];
                track(t, k);
                const res = Reflect.get(t, k, r);
                return res && typeof res === 'object' && !(res instanceof Node) ? reactive(res) : res;
            },
            set: (t, k, v, r) => {
                const old = t[k], hadKey = Array.isArray(t) ? Number(k) < t.length : Object.prototype.hasOwnProperty.call(t, k);
                const res = Reflect.set(t, k, v, r);
                if (shouldTrigger && (!hadKey ? (trigger(t, k), Array.isArray(t) && trigger(t, 'length')) : old !== v && trigger(t, k)));
                return res;
            },
            deleteProperty: (t, k) => {
                const hadKey = Object.prototype.hasOwnProperty.call(t, k);
                const res = Reflect.deleteProperty(t, k);
                if (res && hadKey) {
                    trigger(t, k);
                    if (Array.isArray(t)) trigger(t, 'length');
                }
                return res;
            }
        })).get(obj);
    };

    globalStore = reactive({});

    // 4. DOM Ops
    const ops = {
        text: (el, v) => el.textContent = v ?? '',
        //Fleksibilitas "Escape Hatch"
        html: (el, v) => el.innerHTML = v ?? '',
        value: (el, v) => el.type === 'checkbox' ? el.checked = !!v :
            (el.type === 'radio' && el.name ? el.checked = el.value == v : (el.value != v && (el.value = v ?? ''))),
        attr: (el, v, arg) => v == null || v === false ? el.removeAttribute(arg) : el.setAttribute(arg, v === true ? '' : v),
        class: (el, v) => typeof v === 'string' && v.split(/\s+/).forEach(c => c && el.classList[c[0] === '!' ? 'remove' : 'add'](c[0] === '!' ? c.slice(1) : c)),
        init: () => { }, destroy: () => { }
    };

    // 5. Engine
    const mount = (root) => {
        if (root._m) return; root._m = 1;
        const fac = registry[root.getAttribute('s-data')];
        if (!fac) return;

        const state = reactive(fac());
        state.$refs = {}; state.$root = root; state.$store = globalStore;

        const rootK = [];

        const handleEvent = (e) => {
            let t = e.target;
            if (t._m && (e.type === 'input' || e.type === 'change')) {
                const path = t._m, v = t.type === 'checkbox' ? t.checked : t.value;
                const { ctx: parentObj } = evaluate(t._s || state, path);

                if (path.indexOf('.') === -1) {
                    (t._s || state)[path] = v;
                } else if (parentObj) {
                    const parts = path.split('.');
                    parentObj[parts[parts.length - 1]] = v;
                }
            }

            let hn;
            while (t && t !== root.parentNode) {
                if (hn = metaMap.get(t)?.[e.type]) {
                    const { val: fn, ctx } = evaluate(t._s || state, hn);
                    if (typeof fn === 'function') fn.call(ctx, e);
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
            if (val = el.getAttribute('s-if')) {
                const anchor = document.createTextNode(''), branchK = [];
                el.replaceWith(anchor);
                let node;

                kList.push(() => branchK.forEach(s => s()));

                return kList.push(effect(() => {
                    const { val: res, ctx } = evaluate(scope, val);
                    const truthy = typeof res === 'function' ? res.call(ctx, el) : res;

                    if (truthy) {
                        if (!node) {
                            node = el.cloneNode(true);
                            node.removeAttribute('s-if');
                            walk(node, scope, branchK);
                            anchor.parentNode.insertBefore(node, anchor);
                        }
                    } else if (node) (branchK.forEach(s => s()), branchK.length = 0, node.remove(), node = null);
                }, nextTick));
            }

            if (el.tagName === 'TEMPLATE' && (val = el.getAttribute('s-for'))) {
                const match = val.match(loopRE);
                if (!match) return;
                const [lhs, listKey] = [match[1].replace(/[()]/g, ''), match[2]];
                const [alias, idx] = lhs.split(',').map(s => s.trim());
                const keyAttr = el.getAttribute('s-key');
                const anchor = document.createTextNode('');
                el.replaceWith(anchor);
                let pool = new Map();

                kList.push(() => pool.forEach(r => r.k.forEach(s => s())));

                return kList.push(effect(() => {
                    const { val: rawItems } = evaluate(scope, listKey);
                    const items = rawItems;
                    if (Array.isArray(items)) track(items, 'length');

                    let cursor = anchor;
                    const iterable = Array.isArray(items) ? items : items ? Object.keys(items) : [];
                    const nextPool = new Map();

                    iterable.forEach((raw, i) => {
                        const [key, item] = Array.isArray(items) ? [i, raw] : [raw, items[raw]];

                        let rowKey;
                        if (keyAttr && item) rowKey = item[keyAttr];
                        else rowKey = (typeof item === 'object' && item) ? item : key + '_' + item;

                        let row = pool.get(rowKey);

                        const defineAlias = (targetObj) => {
                            Object.defineProperty(targetObj, alias, {
                                configurable: true, enumerable: true,
                                get: () => items[key],
                                set: (v) => items[key] = v
                            });
                        };

                        if (!row) {
                            const clone = el.content.cloneNode(true);
                            const s = createScope(scope);
                            const rowK = [];

                            defineAlias(s);
                            if (idx) s[idx] = key;

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
                            defineAlias(row.s);
                            if (idx) row.s[idx] = key;
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
                }, nextTick));
            }

            const attrs = el.attributes;
            for (let i = attrs.length - 1; i >= 0; i--) {
                const { name, value } = attrs[i];
                if (name[0] === ':') {
                    kList.push(effect(() => {
                        const { val: res, ctx } = evaluate(scope, value);
                        ops[name.slice(1) === 'class' ? 'class' : 'attr'](el, typeof res === 'function' ? res.call(ctx, el) : res, name.slice(1));
                    }, nextTick));
                } else if (name.startsWith('s-')) {
                    const type = name.slice(2);
                    if (type === 'ref') state.$refs[value] = el;
                    else if (type === 'model') {
                        kList.push(effect(() => {
                            const { val: res } = evaluate(scope, value);
                            ops.value(el, res);
                        }, nextTick));
                        if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
                            el._s = scope; el._m = value;
                            const evt = (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') ? 'change' : 'input';
                            if (!root._e?.has(evt)) (root._e ??= new Set()).add(evt) && root.addEventListener(evt, handleEvent);
                        }
                    } else if (ops[type]) {
                        kList.push(effect(() => {
                            const { val: res, ctx } = evaluate(scope, value);
                            ops[type](el, typeof res === 'function' ? res.call(ctx, el) : res);
                        }, nextTick));
                    } else {
                        el._s = scope;
                        (metaMap.get(el) ?? metaMap.set(el, {}).get(el))[type] = value;
                        if (!root._e?.has(type)) (root._e ??= new Set()).add(type) && root.addEventListener(type, handleEvent);
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

        walk(root, state, rootK);
        state.init?.();

        return {
            unmount: () => (state.destroy?.call(state), rootK.forEach(s => s()), root._e?.forEach(k => root.removeEventListener(k, handleEvent)), root._m = 0)
        };
    };

    return {
        data: (n, f) => registry[n] = f,
        start: () => document.querySelectorAll('[s-data]').forEach(mount),
        store: (k, v) => v === undefined ? globalStore[k] : (globalStore[k] = v)
    };
})();

export default spiki;
