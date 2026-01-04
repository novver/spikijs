const spiki = (() => {
    const registry = Object.create(null),
          [metaMap, targetMap, proxyMap] = [new WeakMap(), new WeakMap(), new WeakMap()],
          loopRE = /^\s*(.*?)\s+in\s+(.+)\s*$/,
          queue = new Set();
          
    let activeEffect, isFlushing, p = Promise.resolve();

    // 1. Helper
    const getValue = (root, path, arg, exec = true) => {
        let v = root;
        if (path.indexOf('.') > -1) {
            for (const p of path.split('.')) if ((v = v?.[p]) === undefined) return;
        } else v = root[path];
        return (exec && typeof v === 'function') ? v.call(root, arg) : v;
    };
    
    // 2. Scheduler
    const nextTick = fn => !queue.has(fn) && queue.add(fn) && !isFlushing && (isFlushing = true) && 
        p.then(() => (queue.forEach(j => j()), queue.clear(), isFlushing = false));

    // 3. Reactivity
    const track = (t, k) => {
        if (!activeEffect) return;
        let dep = (targetMap.get(t) || targetMap.set(t, new Map()).get(t)).get(k) || 
                  (targetMap.get(t).set(k, new Set()).get(k));
        dep.add(activeEffect);
        activeEffect.d.add(dep);
    };

    const trigger = (t, k) => targetMap.get(t)?.get(k)?.forEach(e => e.x ? e.x(e) : e());

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
        return () => (runner.d.forEach(d => d.delete(runner)), runner.d.clear());
    };

    const reactive = (obj) => {
        if (!obj || typeof obj !== 'object' || obj._p || obj instanceof Node) return obj;
        return proxyMap.get(obj) || proxyMap.set(obj, new Proxy(obj, {
            get: (t, k, r) => (k === '_p' ? true : (track(t, k), 
                ((res) => (res && typeof res === 'object' && !(res instanceof Node)) ? reactive(res) : res)(Reflect.get(t, k, r)))),
            set: (t, k, v, r) => {
                const old = t[k], res = Reflect.set(t, k, v, r);
                if (old !== v) { trigger(t, k); Array.isArray(t) && k !== 'length' && trigger(t, 'length'); }
                return res;
            }
        })).get(obj);
    };

    // 4. DOM Ops
    const ops = {
        text: (el, v) => el.textContent = v ?? '',
        html: (el, v) => el.innerHTML = v ?? '',
        value: (el, v) => el.type === 'checkbox' ? el.checked = !!v : 
                         (el.type === 'radio' && el.name) ? el.checked = el.value == v : el.value = v ?? '',
        attr: (el, v, arg) => (v == null || v === false) ? el.removeAttribute(arg) : el.setAttribute(arg, v === true ? '' : v),
        class: (el, v) => typeof v === 'string' && v.split(/\s+/).forEach(c => c && (c[0] === '!' ? el.classList.remove(c.slice(1)) : el.classList.add(c))),
        init: () => {}
    };

    // 5. Engine
    const mount = (root) => {
        if (root._m) return; root._m = 1;
        const fac = registry[root.getAttribute('s-data')];
        if (!fac) return;

        const state = reactive(fac());
        state.$refs = {}; 
        
        const regFx = (fn, kList) => kList.push(effect(fn, nextTick));

        const handleEvent = (e) => {
            let t = e.target, hn;
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
            if (el !== root && el.hasAttribute('s-data')) return mount(el);

            let val;
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
                    let cursor = anchor;
                    const list = Array.isArray(items) ? items : (items ? Object.keys(items) : []);

                    list.forEach((raw, i) => {
                        const [key, item] = Array.isArray(items) ? [i, raw] : [raw, items[raw]];
                        const rowKey = (typeof item === 'object' && item) ? item : key + '_' + item;
                        let row = pool.get(rowKey);

                        if (!row) {
                            const clone = el.content.cloneNode(true), s = Object.create(scope), rowK = [];
                            s[alias] = item; if (idx) s[idx] = key;
                            Array.from(clone.childNodes).forEach(c => walk(c, s, rowK));
                            row = { n: Array.from(clone.childNodes), s, k: rowK }; 
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
                if (name[0] === ':') {
                    regFx(() => ops[name.slice(1) === 'class' ? 'class' : 'attr'](el, getValue(scope, value, el), name.slice(1)), kList);
                } else if (name[0] === 's' && name[1] === '-') {
                    const key = name.slice(2);
                    if (key === 'ref') state.$refs[value] = el;
                    
                    else if (key === 'model') { 
                        regFx(() => ops.value(el, getValue(scope, value, el)), kList);
                        const tag = el.tagName;
                        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
                            const isCheck = el.type === 'checkbox' || el.type === 'radio';
                            el.addEventListener((isCheck || tag === 'SELECT') ? 'change' : 'input', () => {
                                let v = el.type === 'checkbox' ? el.checked : el.value, t = scope, path = value.split('.');
                                if (path.length > 1) { for(let j=0; j<path.length-1; j++) t = t[path[j]]; t[path[path.length-1]] = v; }
                                else scope[value] = v;
                            });
                        }
                    } 
                    else if (ops[key]) regFx(() => ops[key](el, getValue(scope, value, el)), kList);
                    else { 
                        el._s = scope;
                        (metaMap.get(el) || metaMap.set(el, {}).get(el))[key] = value;
                        (root._e ||= new Set()).add(key) && root.addEventListener(key, handleEvent);
                    }
                }
            }

            let child = el.firstElementChild;
            while (child) { walk(child, scope, kList); child = child.nextElementSibling; }
        };

        const rootK = [];
        walk(root, state, rootK);
        if (state.init) state.init();
        return { unmount: () => (rootK.forEach(s => s()), root._m = 0) };
    };

    return { data: (n, f) => registry[n] = f, start: () => document.querySelectorAll('[s-data]').forEach(mount) };
})();

export default spiki;
