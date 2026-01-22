/**
 * SPIKI - Lightweight Binding Framework
 */

(function () {
"use strict";

var spiki = (() => {
    // -------------------------------------------------------------------------
    // 1. STATE & UTILS
    // -------------------------------------------------------------------------
    var cmpReg = Object.create(null);
    var scheduler = [];
    var isFlushing = false;
    var activeEffect = null;
    var pauseTracking = false;
    var globalStore;
    var resolved = Promise.resolve();

    var nextTick = (fn) => {
        if (!fn._q) {
            fn._q = true;
            scheduler.push(fn);
            if (!isFlushing) {
                isFlushing = true;
                resolved.then(() => {
                    var queue = scheduler;
                    scheduler = [];
                    isFlushing = false;
                    var i = queue.length;
                    while (i--) {
                        queue[i]._q = false;
                        queue[i]();
                    }
                });
            }
        }
    };

    var evalPath = (scope, path) => {
        if (typeof path === 'string') {
            return { ctx: scope, val: scope ? scope[path] : undefined };
        }
        var i = 0, len = path.length;
        while (i < len - 1 && scope) {
            scope = scope[path[i++]];
        }
        return { 
            ctx: scope, 
            val: scope ? scope[path[len - 1]] : undefined 
        };
    };

    // -------------------------------------------------------------------------
    // 2. REACTIVITY
    // -------------------------------------------------------------------------
    var arrMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
    var arrInst = {};
    
    arrMethods.forEach(method => {
        arrInst[method] = function(...args) {
            pauseTracking = true;
            try { return Array.prototype[method].apply(this, args); } 
            finally { pauseTracking = false; trigger(this, 'length'); }
        };
    });

    var track = (target, key) => {
        if (activeEffect) {
            var deps = target._d || (Object.defineProperty(target, '_d', { 
                value: Object.create(null), writable: true 
            }), target._d);
            var list = deps[key] || (deps[key] = []);
            if (list.indexOf(activeEffect) === -1) {
                list.push(activeEffect);
                activeEffect.deps.push(list);
            }
        }
    };

    var trigger = (target, key) => {
        if (!pauseTracking && target._d && target._d[key]) {
            var effects = target._d[key].slice();
            var i = 0, len = effects.length;
            for (; i < len; i++) {
                var effect = effects[i];
                effect.sched ? effect.sched(effect) : effect();
            }
        }
    };

    var cleanup = (runner) => {
        var i = runner.deps.length;
        while (i--) {
            var list = runner.deps[i];
            var idx = list.indexOf(runner);
            if (idx !== -1) { 
                list[idx] = list[list.length - 1]; 
                list.pop(); 
            }
        }
        runner.deps = [];
    };

    var effect = (fn, sched) => {
        var runner = () => {
            cleanup(runner);
            var prev = activeEffect;
            activeEffect = runner;
            try { fn(); } finally { activeEffect = prev; }
        };
        runner.deps = [];
        runner.sched = sched;
        runner();
        return () => cleanup(runner);
    };

    var makeReactive = (obj) => {
        if (!obj || typeof obj !== 'object' || obj._y || obj instanceof Node) return obj;
        if (obj._p) return obj._p;

        var proxy = new Proxy(obj, {
            get: (target, key, receiver) => {
                if (key === '_y') return true;
                if (key === '_d') return target._d;
                if (Array.isArray(target) && arrInst.hasOwnProperty(key)) return arrInst[key];
                var desc = Object.getOwnPropertyDescriptor(target, key);
                if (desc && desc.get) {
                    var cacheKey = '_' + key;
                    if (!(cacheKey in target)) effect(() => receiver[cacheKey] = desc.get.call(receiver));
                    return receiver[cacheKey];
                }
                track(target, key);
                var res = Reflect.get(target, key, receiver);
                return (res && typeof res === 'object' && !(res instanceof Node)) ? makeReactive(res) : res;
            },
            set: (target, key, val, receiver) => {
                var old = target[key];
                var isArr = Array.isArray(target);
                var hadKey = isArr ? Number(key) < target.length : Object.prototype.hasOwnProperty.call(target, key);
                if (!isArr && !hadKey) {
                    var proto = Object.getPrototypeOf(target);
                     while (proto && proto !== Object.prototype) {
                        if (Object.prototype.hasOwnProperty.call(proto, key)) {
                            var res = Reflect.set(proto, key, val);
                            if (!pauseTracking && val !== old) trigger(target, key);
                            return res;
                        }
                        proto = Object.getPrototypeOf(proto);
                    }
                }
                var res = Reflect.set(target, key, val, receiver);
                if (!pauseTracking && res) {
                    if (!hadKey || val !== old) {
                        trigger(target, key);
                        if (isArr) trigger(target, 'length');
                        else if (!hadKey) trigger(target, '_k');
                    }
                }
                return res;
            },
            deleteProperty: (target, key) => {
                var hadKey = Object.prototype.hasOwnProperty.call(target, key);
                var res = Reflect.deleteProperty(target, key);
                if (res && hadKey) {
                    trigger(target, key);
                    if (Array.isArray(target)) trigger(target, 'length');
                    else trigger(target, '_k');
                }
                return res;
            },
            ownKeys: (target) => {
                track(target, '_k');
                return Reflect.ownKeys(target);
            }
        });
        
        Object.defineProperty(obj, '_p', { value: proxy, enumerable: false });
        return proxy;
    };

    globalStore = makeReactive({});

    // -------------------------------------------------------------------------
    // 3. DOM & COMPONENT ENGINE
    // -------------------------------------------------------------------------
    var domOps = Object.create(null);
    domOps.text = (el, val) => { 
        val = val == null ? '' : val;
        if (el.textContent !== String(val)) el.textContent = val;
    };
    domOps.html = (el, val) => { 
        if (el.innerHTML != val) el.innerHTML = val == null ? '' : val; 
    };
    domOps.value = (el, val) => {
        if (el.type === 'checkbox') el.checked = !!val;
        else if (el.type === 'radio') el.checked = (el.value == val);
        else if (el.value != val) el.value = val == null ? '' : val;
    };
    domOps.attr = (el, val, name) => {
        if (val == null || val === false) el.removeAttribute(name);
        else {
            var str = val === true ? '' : String(val);
            if (el.getAttribute(name) !== str) el.setAttribute(name, str);
        }
    };
    domOps.class = (el, val) => {
        var base = el._n || '';
        var dyn = '';
        if (typeof val === 'string') {
            dyn = val;
        } else if (val) {
            for (var k in val) if (val[k]) dyn += (dyn ? ' ' : '') + k;
        }
        var res = base + (base && dyn ? ' ' : '') + dyn;
        if (el.className !== res) el.className = res;
    };

    var mount = (rootElement, parentScope) => {
        if (rootElement._m) return rootElement._m;
        
        var name = rootElement.getAttribute('s-data');
        if (!cmpReg[name]) return;

        var data = cmpReg[name]();
        if (parentScope) Object.setPrototypeOf(data, parentScope);
        
        var state = makeReactive(data);
        state.$refs = {}; 
        state.$root = rootElement; 
        state.$store = globalStore; 
        state.$parent = parentScope;
        
        var cleanups = [];
        var listeners = Object.create(null);

        var handle = (event) => {
            var target = event.target;
            if (event.type === 'input' && target._c) return;
            var limit = rootElement.parentNode;
            var type = event.type; 
        
            while (target && target !== limit) {
                var handlers = target._h && target._h[type];
                
                if (handlers) {
                    var scope = target._s; 
                    var i = handlers.length;
                    while (i--) {
                        var handler = handlers[i];
                        var path = handler.p;
        
                        if (handler.model) {
                            var val = target.type === 'checkbox' ? target.checked : target.value;
                            if (typeof val === 'string') {
                                var clean = val.trim();
                                if (clean && isFinite(clean)) {
                                     if (clean.charCodeAt(0) !== 48 || clean.length === 1 || clean.charCodeAt(1) === 46) {
                                        val = Number(clean);
                                    }
                                }
                            }
                            if (typeof path === 'string') {
                                if (scope) scope[path] = val;
                            } else {
                                var ctx = scope;
                                var k = 0, kLen = path.length - 1;
                                while (k < kLen && ctx) ctx = ctx[path[k++]];
                                if (ctx) ctx[path[kLen]] = val;
                            }
                        } else {
                            var result = evalPath(scope, path);
                            if (typeof result.val === 'function') result.val.call(result.ctx, event);
                        }
                    }
                }
                target = target.parentNode;
            }
        };

        var addListen = (type) => {
            if (!listeners[type]) { 
                listeners[type] = true; 
                rootElement.addEventListener(type, handle); 
            }
        };

        var walk = (el, scope, parentCleanups) => {
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore')) return;

            if (el !== rootElement && el.hasAttribute('s-data')) {
                var component = mount(el, scope);
                if (component) parentCleanups.push(component.unmount);
                return;
            }

            var directiveIf = el.getAttribute('s-if');
            var directiveFor = !directiveIf && el.tagName === 'TEMPLATE' && el.getAttribute('s-for');
            var bindings = [];

            if (el.hasAttribute('class') && !el._n) el._n = el.className;

            if (directiveIf) {
                var end = document.createTextNode('');
                var active = null;
                var cBranch = [];
                el.replaceWith(end);
                var negate = directiveIf[0] === '!';
                var path = negate ? directiveIf.slice(1) : directiveIf;
                var p = path.indexOf('.') === -1 ? path : path.split('.');
                
                parentCleanups.push(() => { cBranch.forEach(c => c()); });
                
                return parentCleanups.push(effect(() => {
                    var show = evalPath(scope, p).val;
                    if (negate) show = !show;
                    if (show) {
                        if (!active) {
                            active = el.cloneNode(true); 
                            active.removeAttribute('s-if');
                            walk(active, scope, cBranch);
                            end.parentNode.insertBefore(active, end);
                        }
                    } else if (active) {
                        cBranch.forEach(c => c()); cBranch = []; active.remove(); active = null;
                    }
                }, nextTick));
            }

            if (directiveFor) {
                var inIdx = directiveFor.indexOf(' in ');
                if (inIdx !== -1) {
                    var leftSide = directiveFor.slice(0, inIdx).trim();
                    var listKey = directiveFor.slice(inIdx + 4).trim();
                    var leftParts = leftSide.replace(/[()]/g, '').split(',');
                    var alias = leftParts[0].trim();
                    var idxAlias = leftParts[1] ? leftParts[1].trim() : null;
                    var listPath = listKey.indexOf('.') === -1 ? listKey : listKey.split('.');
                    var keyAttr = el.getAttribute('s-key');
                    var keyPath = keyAttr ? (keyAttr.indexOf('.') === -1 ? keyAttr : keyAttr.split('.')) : null;

                    var end = document.createTextNode('');
                    var nodePool = Object.create(null);
                    var usedKeys;
                    el.replaceWith(end);

                     parentCleanups.push(() => { 
                          for(var k in nodePool) nodePool[k].cleanups.forEach(c => c()); 
                     });

                    return parentCleanups.push(effect(() => {
                        var list = evalPath(scope, listPath).val || [];
                        if (Array.isArray(list)) track(list, 'length');
                        var frag = document.createDocumentFragment();
                        var cursor = end;
                        usedKeys = Object.create(null);
                        var isArr = Array.isArray(list);
                        var keys = isArr ? list : Object.keys(list);
                        var len = isArr ? list.length : keys.length;

                        for (var i = 0; i < len; i++) {
                            var key = isArr ? i : keys[i];
                            var item = isArr ? list[i] : list[key];
                            var unique;
                            if (item == null || typeof item !== 'object') unique = String(item);
                            else if (keyPath) unique = evalPath(item, keyPath).val;
                            else unique = String(key) + '_o';
                            
                            if (usedKeys[unique]) unique += '_' + i;
                            var row = nodePool[unique];
                            if (row) {
                                row.scope[alias] = item;
                                if (idxAlias) row.scope[idxAlias] = key;
                            } else {
                                var clone = el.content.cloneNode(true);
                                var rowScope = makeReactive(Object.create(scope));
                                rowScope[alias] = item; if (idxAlias) rowScope[idxAlias] = key;
                                var rowNodes = Array.prototype.slice.call(clone.childNodes);
                                var rowCleanups = [];
                                for(var n=0; n<rowNodes.length; n++) walk(rowNodes[n], rowScope, rowCleanups);
                                row = { nodes: rowNodes, scope: rowScope, cleanups: rowCleanups };
                                nodePool[unique] = row;
                            }
                            if (row.nodes[0] !== cursor.nextSibling) {
                                for(var n=0; n<row.nodes.length; n++) frag.appendChild(row.nodes[n]);
                                cursor.parentNode.insertBefore(frag, cursor.nextSibling);
                            }
                            cursor = row.nodes[row.nodes.length-1];
                            usedKeys[unique] = true;
                        }
                        for (var k in nodePool) if (!usedKeys[k]) {
                            nodePool[k].cleanups.forEach(c => c());
                            nodePool[k].nodes.forEach(n => n.remove());
                            delete nodePool[k];
                        }
                    }, nextTick));
                }
            }

            if (el.hasAttributes()) {
                var attrs = el.attributes;
                var i = attrs.length;
                while (i--) {
                    var attr = attrs[i];
                    var attrName = attr.name;
                    var attrValue = attr.value;
                    
                    if (attrName.charCodeAt(0) === 58) { 
                        var realName = attrName.slice(1);
                        var neg = attrValue.charCodeAt(0) === 33; 
                        var rawPath = neg ? attrValue.slice(1) : attrValue;
                        var p = rawPath.indexOf('.') === -1 ? rawPath : rawPath.split('.');
                        bindings.push({ type: 'attr', name: realName, path: p, neg: neg });
                    } 
                    else if (attrName.charCodeAt(0) === 115 && attrName.charCodeAt(1) === 45) {
                        var type = attrName.slice(2);
                        var p = attrValue.indexOf('.') === -1 ? attrValue : attrValue.split('.');

                        if (type === 'init' || type === 'destroy') {
                            ((type, path) => {
                                var result = evalPath(scope, path);
                                if (typeof result.val === 'function') {
                                    if (type === 'init') {
                                        nextTick(() => {
                                            var cleanupFn = result.val.call(result.ctx, el);
                                            if (typeof cleanupFn === 'function') parentCleanups.push(cleanupFn);
                                        });
                                    }
                                    else parentCleanups.push(() => result.val.call(result.ctx, el));
                                }
                            })(type, p);
                        }
                        else if (type === 'effect') {
                            parentCleanups.push(effect(() => {
                                var res = evalPath(scope, p);
                                if (typeof res.val === 'function') res.val.call(res.ctx, el);
                            }, nextTick));
                        }
                        else if (type === 'model') {
                             bindings.push({ type: 'value', path: p });
                             el._s = scope; el._h = el._h || {};
                             var evt = (el.type === 'checkbox' || el.type === 'radio' || el.tagName==='SELECT') ? 'change' : 'input';
                             
                             if (evt === 'input') {
                                 el.addEventListener('compositionstart', () => el._c = true);
                                 el.addEventListener('compositionend', () => { el._c = false; handle({target: el, type: 'input'}); });
                             }

                             (el._h[evt] = el._h[evt] || []).unshift({ model: true, p: p });
                             addListen(evt);
                        } else if (type === 'ref') {
                            state.$refs[attrValue] = el;
                        } else if (domOps[type]) {
                            bindings.push({ type: type, path: p });
                        } else {
                            el._s = scope; el._h = el._h || {};
                            (el._h[type] = el._h[type] || []).push({ p: p });
                            addListen(type);
                        }
                    }
                }
            }

            if (bindings.length) {
                parentCleanups.push(effect(() => {
                    var i = bindings.length;
                    while (i--) {
                        var binding = bindings[i];
                        var result = evalPath(scope, binding.path);
                        var val = (result.val && typeof result.val === 'function') ? result.val.call(result.ctx, el) : result.val;
                        
                        if (binding.type === 'attr') {
                            if (binding.neg) val = !val;
                            if (binding.name === 'class') domOps.class(el, val);
                            else domOps.attr(el, val, binding.name);
                        } else {
                            domOps[binding.type](el, val);
                        }
                    }
                }, nextTick));
            }

            var child = el.firstChild;
            while (child) { 
                var nextSibling = child.nextSibling; 
                walk(child, scope, parentCleanups); 
                child = nextSibling; 
            }
        };

        walk(rootElement, state, cleanups);
        if (state.init) state.init();

        var instance = {
            unmount: () => {
                if (state.destroy) state.destroy.call(state);
                cleanups.forEach(c => c());
                for(var k in listeners) rootElement.removeEventListener(k, handle);
                rootElement._m = null;
            }
        };
        rootElement._m = instance;
        return instance;
    };

    return {
        data: (name, factory) => { cmpReg[name] = factory; },
        start: () => {
            var els = document.querySelectorAll('[s-data]');
            var i = els.length;
            while (i--) mount(els[i]);
        },
        store: (k, v) => v === undefined ? globalStore[k] : (globalStore[k] = v),
        raw: (o) => (o && o._p) || o,
        mount: (el) => mount(el),
        unmount: (el) => { if (el && el._m) el._m.unmount(); }
    };
})();

window.spiki = spiki;
})();
