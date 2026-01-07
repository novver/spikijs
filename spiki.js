var spiki = (function () {
    var registry = Object.create(null);
    var metaMap = new WeakMap();
    var targetMap = new WeakMap();
    var proxyMap = new WeakMap();
    var pathCache = new Map();
    var queue = new Set();
    var loopRE = /^\s*(.*?)\s+in\s+(.+)\s*$/;

    var activeEffect, isFlushing, globalStore;
    var shouldTrigger = true;
    var p = Promise.resolve();

    // 1. Array Interceptors
    var arrayInstrumentations = {};
    ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].forEach(function (m) {
        arrayInstrumentations[m] = function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            shouldTrigger = false;
            try {
                var res = Array.prototype[m].apply(this, args);
                return res;
            } finally {
                shouldTrigger = true;
                trigger(this, 'length');
            }
        };
    });

    // 2. Helpers
    var createScope = function (parent) {
        var proto = Object.create(parent);
        return new Proxy(proto, {
            set: function (target, key, value, receiver) {
                if (target.hasOwnProperty(key)) return Reflect.set(target, key, value, receiver);
                var cursor = target;
                while (cursor && !Object.prototype.hasOwnProperty.call(cursor, key)) {
                    cursor = Object.getPrototypeOf(cursor);
                }
                return Reflect.set(cursor || target, key, value);
            }
        });
    };

    var evaluate = function (scope, path) {
        if (typeof path !== 'string') return { val: path, ctx: scope };

        if (path.indexOf('.') === -1) {
            return { val: scope ? scope[path] : undefined, ctx: scope };
        }

        var parts = pathCache.get(path);
        if (!parts) {
            if (pathCache.size > 1000) pathCache.clear();
            parts = path.split('.');
            pathCache.set(path, parts);
        }

        var val = scope, ctx = scope;
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (val == null) {
                return { val: val, ctx: null };
            }
            ctx = val;
            val = val[part];
        }
        return { val: val, ctx: ctx };
    };

    var nextTick = function (fn) {
        return !queue.has(fn) && queue.add(fn) && !isFlushing && (isFlushing = true) &&
            p.then(function () {
                queue.forEach(function (j) { j(); });
                queue.clear();
                isFlushing = false;
            });
    };

    // 3. Reactivity
    var track = function (t, k) {
        if (!activeEffect) return;
        var deps = targetMap.get(t);
        if (!deps) {
            deps = new Map();
            targetMap.set(t, deps);
        }
        var dep = deps.get(k);
        if (!dep) {
            dep = new Set();
            deps.set(k, dep);
        }
        dep.add(activeEffect);
        activeEffect.d.add(dep);
    };

    var trigger = function (t, k) {
        var depsMap, dep;
        if (shouldTrigger && (depsMap = targetMap.get(t)) && (dep = depsMap.get(k))) {
            dep.forEach(function (e) {
                e.x ? e.x(e) : e();
            });
        }
    };

    var effect = function (fn, scheduler) {
        var runner = function () {
            runner.d.forEach(function (d) { d.delete(runner); });
            runner.d.clear();
            var prev = activeEffect;
            activeEffect = runner;
            try { fn(); } finally { activeEffect = prev; }
        };
        runner.d = new Set();
        runner.x = scheduler;
        runner();
        return function () {
            runner.d.forEach(function (d) { d.delete(runner); });
            runner.d.clear();
            queue.delete(runner);
        };
    };

    var reactive = function (obj) {
        if (!obj || typeof obj !== 'object' || obj._p || obj instanceof Node) return obj;
        var existing = proxyMap.get(obj);
        if (existing) return existing;

        var proxy = new Proxy(obj, {
            get: function (t, k, r) {
                if (k === '_p') return true;
                if (Array.isArray(t) && arrayInstrumentations.hasOwnProperty(k)) return arrayInstrumentations[k];
                track(t, k);
                var res = Reflect.get(t, k, r);
                return res && typeof res === 'object' && !(res instanceof Node) ? reactive(res) : res;
            },
            set: function (t, k, v, r) {
                var old = t[k];
                var hadKey = Array.isArray(t) ? Number(k) < t.length : Object.prototype.hasOwnProperty.call(t, k);
                var res = Reflect.set(t, k, v, r);
                if (shouldTrigger) {
                    if (!hadKey) {
                        trigger(t, k);
                        if (Array.isArray(t)) trigger(t, 'length');
                    } else if (old !== v) {
                        trigger(t, k);
                    }
                }
                return res;
            },
            deleteProperty: function (t, k) {
                var hadKey = Object.prototype.hasOwnProperty.call(t, k);
                var res = Reflect.deleteProperty(t, k);
                if (res && hadKey) {
                    trigger(t, k);
                    if (Array.isArray(t)) trigger(t, 'length');
                }
                return res;
            }
        });
        proxyMap.set(obj, proxy);
        return proxy;
    };

    globalStore = reactive({});

    // 4. DOM Ops
    var ops = {
        text: function (el, v) { el.textContent = (v !== null && v !== undefined) ? v : ''; },
        html: function (el, v) { el.innerHTML = (v !== null && v !== undefined) ? v : ''; },
        value: function (el, v) {
            if (el.type === 'checkbox') {
                el.checked = !!v;
            } else if (el.type === 'radio' && el.name) {
                el.checked = el.value == v;
            } else {
                if (el.value != v) el.value = (v !== null && v !== undefined) ? v : '';
            }
        },
        attr: function (el, v, arg) {
            (v == null || v === false) ? el.removeAttribute(arg) : el.setAttribute(arg, v === true ? '' : v);
        },
        class: function (el, v) {
            if (typeof v === 'string') {
                v.split(/\s+/).forEach(function (c) {
                    if (c) el.classList[c[0] === '!' ? 'remove' : 'add'](c[0] === '!' ? c.slice(1) : c);
                });
            }
        },
        init: function () { },
        destroy: function () { }
    };

    // 5. Engine
    var mount = function (root) {
        if (root._m) return;
        root._m = 1;
        var fac = registry[root.getAttribute('s-data')];
        if (!fac) return;

        var state = reactive(fac());
        state.$refs = {};
        state.$root = root;
        state.$store = globalStore;

        var rootK = [];

        var handleEvent = function (e) {
            var t = e.target;
            if (t._m && (e.type === 'input' || e.type === 'change')) {
                var path = t._m;
                var v = t.type === 'checkbox' ? t.checked : t.value;
                var evaluated = evaluate(t._s || state, path);
                var parentObj = evaluated.ctx;

                if (path.indexOf('.') === -1) {
                    (t._s || state)[path] = v;
                } else if (parentObj) {
                    var parts = path.split('.');
                    parentObj[parts[parts.length - 1]] = v;
                }
            }

            var hn;
            while (t && t !== root.parentNode) {
                var meta = metaMap.get(t);
                if (meta && (hn = meta[e.type])) {
                    var evRes = evaluate(t._s || state, hn);
                    var fn = evRes.val;
                    var ctx = evRes.ctx;
                    if (typeof fn === 'function') fn.call(ctx, e);
                }
                t = t.parentNode;
            }
        };

        var walk = function (el, scope, kList) {
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore')) return;

            if (el !== root && el.hasAttribute('s-data')) {
                var child = mount(el);
                if (child) kList.push(child.unmount);
                return;
            }

            var val;
            if ((val = el.getAttribute('s-if'))) {
                var anchor = document.createTextNode('');
                var branchK = [];
                el.replaceWith(anchor);
                var node;

                kList.push(function () { branchK.forEach(function (s) { s(); }); });

                return kList.push(effect(function () {
                    var ev = evaluate(scope, val);
                    var res = ev.val;
                    var ctx = ev.ctx;
                    var truthy = typeof res === 'function' ? res.call(ctx, el) : res;

                    if (truthy) {
                        if (!node) {
                            node = el.cloneNode(true);
                            node.removeAttribute('s-if');
                            walk(node, scope, branchK);
                            anchor.parentNode.insertBefore(node, anchor);
                        }
                    } else if (node) {
                        branchK.forEach(function (s) { s(); });
                        branchK.length = 0;
                        node.remove();
                        node = null;
                    }
                }, nextTick));
            }

            if (el.tagName === 'TEMPLATE' && (val = el.getAttribute('s-for'))) {
                var match = val.match(loopRE);
                if (!match) return;
                var lhs = match[1].replace(/[()]/g, '');
                var listKey = match[2];
                var splitLhs = lhs.split(',');
                var alias = splitLhs[0].trim();
                var idx = splitLhs[1] ? splitLhs[1].trim() : null;

                var keyAttr = el.getAttribute('s-key');
                var anchor_1 = document.createTextNode('');
                el.replaceWith(anchor_1);
                var pool = new Map();

                kList.push(function () {
                    pool.forEach(function (r) {
                        r.k.forEach(function (s) { s(); });
                    });
                });

                return kList.push(effect(function () {
                    var ev = evaluate(scope, listKey);
                    var rawItems = ev.val;
                    var items = rawItems;
                    if (Array.isArray(items)) track(items, 'length');

                    var cursor = anchor_1;
                    var iterable = Array.isArray(items) ? items : items ? Object.keys(items) : [];
                    var nextPool = new Map();

                    iterable.forEach(function (raw, i) {
                        var key = Array.isArray(items) ? i : raw;
                        var item = Array.isArray(items) ? raw : items[raw];

                        var rowKey;
                        if (keyAttr && item) rowKey = item[keyAttr];
                        else rowKey = (typeof item === 'object' && item) ? item : key + '_' + item;

                        var row = pool.get(rowKey);

                        var defineAlias = function (targetObj) {
                            Object.defineProperty(targetObj, alias, {
                                configurable: true, enumerable: true,
                                get: function () { return items[key]; },
                                set: function (v) { items[key] = v; }
                            });
                        };

                        if (!row) {
                            var clone = el.content.cloneNode(true);
                            var s = createScope(scope);
                            var rowK = [];

                            defineAlias(s);
                            if (idx) s[idx] = key;

                            var nodes = [];
                            var c = clone.firstChild;
                            while (c) {
                                nodes.push(c);
                                var next = c.nextSibling;
                                walk(c, s, rowK);
                                c = next;
                            }
                            row = { n: nodes, s: s, k: rowK };
                        } else {
                            defineAlias(row.s);
                            if (idx) row.s[idx] = key;
                        }

                        if (row.n[0] !== cursor.nextSibling) {
                            var frag = document.createDocumentFragment();
                            row.n.forEach(function (n) { frag.appendChild(n); });
                            cursor.parentNode.insertBefore(frag, cursor.nextSibling);
                        }
                        cursor = row.n[row.n.length - 1];
                        nextPool.set(rowKey, row);
                        pool.delete(rowKey);
                    });
                    pool.forEach(function (row) {
                        row.k.forEach(function (s) { s(); });
                        row.n.forEach(function (n) { n.remove(); });
                    });
                    pool = nextPool;
                }, nextTick));
            }

            var attrs = el.attributes;
            for (var i = attrs.length - 1; i >= 0; i--) {
                (function (attr) {
                    var name = attr.name;
                    var value = attr.value;
                    
                    if (name[0] === ':') {
                        kList.push(effect(function () {
                            var ev = evaluate(scope, value);
                            var res = ev.val;
                            var ctx = ev.ctx;
                            ops[name.slice(1) === 'class' ? 'class' : 'attr'](el, typeof res === 'function' ? res.call(ctx, el) : res, name.slice(1));
                        }, nextTick));
                        
                    } else if (name[0] === 's' && name[1] === '-') {
                        var type = name.slice(2);
                        if (type === 'ref') {
                            state.$refs[value] = el;
                        } else if (type === 'model') {
                            kList.push(effect(function () {
                                var ev = evaluate(scope, value);
                                ops.value(el, ev.val);
                            }, nextTick));
                            if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
                                el._s = scope; el._m = value;
                                var evt = (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') ? 'change' : 'input';
                                if (!root._e) root._e = new Set();
                                if (!root._e.has(evt)) {
                                    root._e.add(evt);
                                    root.addEventListener(evt, handleEvent);
                                }
                            }
                        } else if (ops[type]) {
                            kList.push(effect(function () {
                                var ev = evaluate(scope, value);
                                var res = ev.val;
                                var ctx = ev.ctx;
                                ops[type](el, typeof res === 'function' ? res.call(ctx, el) : res);
                            }, nextTick));
                        } else {
                            el._s = scope;
                            var meta = metaMap.get(el);
                            if (!meta) {
                                meta = {};
                                metaMap.set(el, meta);
                            }
                            meta[type] = value;
                            if (!root._e) root._e = new Set();
                            if (!root._e.has(type)) {
                                root._e.add(type);
                                root.addEventListener(type, handleEvent);
                            }
                        }
                    }
                })(attrs[i]);
            }

            var child = el.firstElementChild;
            while (child) {
                var next = child.nextElementSibling;
                walk(child, scope, kList);
                child = next;
            }
        };

        walk(root, state, rootK);
        if (state.init) state.init();

        return {
            unmount: function () {
                if (state.destroy) state.destroy.call(state);
                rootK.forEach(function (s) { s(); });
                if (root._e) root._e.forEach(function (k) { root.removeEventListener(k, handleEvent); });
                root._m = 0;
            }
        };
    };

    return {
        data: function (n, f) { registry[n] = f; },
        start: function () {
            var els = document.querySelectorAll('[s-data]');
            for (var i = 0; i < els.length; i++) {
                mount(els[i]);
            }
        },
        store: function (k, v) { return v === undefined ? globalStore[k] : (globalStore[k] = v); }
    };
})();

export default spiki;
