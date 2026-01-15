/**
 * SPIKI - Lightweight Binding Framework
 */

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
                    var queue = scheduler.slice();
                    scheduler = [];
                    isFlushing = false;
                    
                    for (var i = 0; i < queue.length; i++) {
                        queue[i]._q = false;
                        queue[i]();
                    }
                });
            }
        }
    };

    var evalPath = (scope, path) => {
        if (path.indexOf('.') === -1) {
            return { val: scope[path], ctx: scope };
        }
        
        var parts = path.split('.');
        var val = scope;
        var ctx = scope;
        
        for (var i = 0; i < parts.length; i++) {
            if (val == null) return { val: undefined, ctx: null };
            ctx = val;
            val = val[parts[i]];
        }
        return { val: val, ctx: ctx };
    };

    // -------------------------------------------------------------------------
    // 2. REACTIVITY
    // -------------------------------------------------------------------------
    var arrMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
    var arrInst = {};
    
    arrMethods.forEach(method => {
        arrInst[method] = function() {
            pauseTracking = true;
            try { 
                return Array.prototype[method].apply(this, arguments); 
            } finally {  
                pauseTracking = false; 
                trigger(this, 'length'); 
            }
        };
    });

    var track = (target, key) => {
        if (activeEffect) {
            var deps = target._d || (Object.defineProperty(target, '_d', { 
                value: Object.create(null), 
                writable: true 
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
            for (var i = 0; i < effects.length; i++) {
                var effect = effects[i];
                effect.sched ? effect.sched(effect) : effect();
            }
        }
    };

    var cleanup = (runner) => {
        for (var i = 0; i < runner.deps.length; i++) {
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
            try { 
                fn(); 
            } finally { 
                activeEffect = prev; 
            }
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
                
                track(target, key);
                var res = Reflect.get(target, key, receiver);
                return (res && typeof res === 'object' && !(res instanceof Node)) 
                    ? makeReactive(res) 
                    : res;
            },
            set: (target, key, val, receiver) => {
                var old = target[key];
                var isArr = Array.isArray(target);
                var hadKey = isArr 
                    ? Number(key) < target.length 
                    : Object.prototype.hasOwnProperty.call(target, key);
                
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
    var domOps = {
        text: (el, val) => { 
            el.textContent = val == null ? '' : val; 
        },
        html: (el, val) => { 
            if (el.innerHTML != val) el.innerHTML = val == null ? '' : val; 
        },
        value: (el, val) => {
            if (el.type === 'checkbox') {
                el.checked = !!val;
            } else if (el.type === 'radio') {
                el.checked = (el.value == val);
            } else if (el.value != val) {
                el.value = val == null ? '' : val;
            }
        },
        attr: (el, val, name) => {
            if (val == null || val === false) {
                el.removeAttribute(name);
            } else {
                el.setAttribute(name, val === true ? '' : val);
            }
        },
        class: (el, val) => {
            if (typeof val === 'string') {
                var parts = val.match(/\S+/g) || [];
                for (var i = 0; i < parts.length; i++) {
                    var c = parts[i];
                    c[0] === '!' 
                        ? el.classList.remove(c.slice(1)) 
                        : el.classList.add(c);
                }
            } else if (val) {
                for (var cls in val) {
                    var add = !!val[cls];
                    if (cls.indexOf(' ') !== -1) {
                         var parts = cls.split(/\s+/);
                         for (var j=0; j<parts.length; j++) {
                             if(parts[j]) el.classList.toggle(parts[j], add);
                         }
                    } else {
                        el.classList.toggle(cls, add);
                    }
                }
            }
        },
        effect: () => {}, 
        init: () => {}, 
        destroy: () => {}, 
        model: () => {}, 
        ref: () => {}
    };

    var mount = (rootElement, parentScope) => {
        if (rootElement._m) return;
        
        var name = rootElement.getAttribute('s-data');
        if (!cmpReg[name]) return;

        rootElement._m = true;
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
            while (target && target !== rootElement.parentNode) {
                var handlers = target._h && target._h[event.type];
                if (handlers) {
                    for (var i = 0; i < handlers.length; i++) {
                        var handler = handlers[i];
                        if (handler.model) {
                            var val = target.type === 'checkbox' ? target.checked : target.value;
                            var result = evalPath(target._s, handler.path);
                            if (result.ctx) {
                                result.ctx[result.ctx === target._s ? handler.path : handler.path.split('.').pop()] = val;
                            }
                        } else {
                            var result = evalPath(target._s, handler.path);
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

            if (directiveIf) {
                var end = document.createTextNode('');
                var active = null;
                var cBranch = [];
                
                el.replaceWith(end);
                var negate = directiveIf[0] === '!';
                var path = negate ? directiveIf.slice(1) : directiveIf;
                
                parentCleanups.push(() => { cBranch.forEach(cleanup => cleanup()); });
                
                return parentCleanups.push(effect(() => {
                    var show = evalPath(scope, path).val;
                    if (negate) show = !show;
                    
                    if (show) {
                        if (!active) {
                            active = el.cloneNode(true); 
                            active.removeAttribute('s-if');
                            walk(active, scope, cBranch);
                            end.parentNode.insertBefore(active, end);
                        }
                    } else if (active) {
                        cBranch.forEach(cleanup => cleanup()); 
                        cBranch = [];
                        active.remove(); 
                        active = null;
                    }
                }, nextTick));
            }

            if (directiveFor) {
                var regexMatch = directiveFor.match(/^\s*(.*?)\s+in\s+(.+)\s*$/);
                if (regexMatch) {
                    var leftHandSide = regexMatch[1].split(',').map(s => s.trim().replace(/[()]/g, ''));
                    var alias = leftHandSide[0];
                    var idxAlias = leftHandSide[1];
                    var listKey = regexMatch[2].trim();
                    var keyAttr = el.getAttribute('s-key');
                    var end = document.createTextNode('');
                    var nodePool = Object.create(null);
                    var usedKeys;
                    
                    el.replaceWith(end);

                     parentCleanups.push(() => { 
                          for(var key in nodePool) nodePool[key].cleanups.forEach(cleanup => cleanup()); 
                     });

                    return parentCleanups.push(effect(() => {
                        var list = evalPath(scope, listKey).val || [];
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
                            if (item == null || typeof item !== 'object') {
                                unique = String(item);
                            } else if (keyAttr) {
                                unique = evalPath(item, keyAttr).val;
                            } else {
                                unique = String(key) + '_o';
                            }
                            
                            if (usedKeys[unique]) unique += '_' + i;
                            
                            var row = nodePool[unique];
                            if (row) {
                                row.scope[alias] = item;
                                if (idxAlias) row.scope[idxAlias] = key;
                            } else {
                                var clone = el.content.cloneNode(true);
                                var rowScope = makeReactive(Object.create(scope));
                                
                                rowScope[alias] = item; 
                                if (idxAlias) rowScope[idxAlias] = key;
                                
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

                        for (var key in nodePool) {
                            if (!usedKeys[key]) {
                                nodePool[key].cleanups.forEach(cleanup => cleanup());
                                for(var n=0; n<nodePool[key].nodes.length; n++) nodePool[key].nodes[n].remove();
                                delete nodePool[key];
                            }
                        }
                    }, nextTick));
                }
            }

            if (el.hasAttributes()) {
                var attrs = el.attributes;
                for (var i = 0; i < attrs.length; i++) {
                    var attrName = attrs[i].name;
                    var attrValue = attrs[i].value;
                    
                    if (attrName[0] === ':') {
                        var realName = attrName.slice(1);
                        var neg = attrValue[0] === '!';
                        bindings.push({ type: 'attr', name: realName, path: neg ? attrValue.slice(1) : attrValue, neg: neg });
                    } else if (attrName.indexOf('s-') === 0) {
                        var type = attrName.slice(2);
                        if (type === 'data') continue;
                        
                        if (type === 'init' || type === 'destroy') {
                            ((type, path) => {
                                var result = evalPath(scope, path);
                                if (typeof result.val === 'function') {
                                    if (type === 'init') {
                                        nextTick(() => result.val.call(result.ctx, el));
                                    } else {
                                        parentCleanups.push(() => result.val.call(result.ctx, el));
                                    }
                                }
                            })(type, attrValue);
                        } else if (type === 'model') {
                             bindings.push({ type: 'value', path: attrValue });
                             el._s = scope; 
                             el._h = el._h || {};
                             var evt = (el.type === 'checkbox' || el.type === 'radio' || el.tagName==='SELECT') 
                                ? 'change' 
                                : 'input';
                                
                             (el._h[evt] = el._h[evt] || []).unshift({ model: true, path: attrValue });
                             addListen(evt);
                        } else if (type === 'ref') {
                            state.$refs[attrValue] = el;
                        } else if (domOps[type]) {
                            bindings.push({ type: type, path: attrValue });
                        } else {
                            el._s = scope; 
                            el._h = el._h || {};
                            (el._h[type] = el._h[type] || []).push({ path: attrValue });
                            addListen(type);
                        }
                    }
                }
            }

            if (bindings.length) {
                parentCleanups.push(effect(() => {
                    for (var i = 0; i < bindings.length; i++) {
                        var binding = bindings[i];
                        var result = evalPath(scope, binding.path);
                        var val = (result.val && typeof result.val === 'function') ? result.val.call(result.ctx, el) : result.val;
                        
                        if (binding.type === 'attr') {
                            if (binding.neg) val = !val;
                            if (binding.name === 'class') {
                                domOps.class(el, val);
                            } else if (binding.name === 'hidden' && binding.neg) {
                                domOps.attr(el, val, 'hidden');
                            } else {
                                domOps.attr(el, val, binding.name);
                            }
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

        return {
            unmount: () => {
                if (state.destroy) state.destroy.call(state);
                cleanups.forEach(cleanup => cleanup());
                for(var k in listeners) rootElement.removeEventListener(k, handle);
                rootElement._m = false;
            }
        };
    };

    return {
        data: (name, factory) => { cmpReg[name] = factory; },
        start: () => {
            var els = document.querySelectorAll('[s-data]');
            for(var i=0; i<els.length; i++) mount(els[i]);
        },
        store: (k, v) => v === undefined ? globalStore[k] : (globalStore[k] = v),
        raw: (o) => (o && o._r) || o
    };
})();

export default spiki;
