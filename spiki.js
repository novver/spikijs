(function () {
"use strict";

var spiki = (() => {
    // =========================================================================
    // 1. STATE & UTILS
    // =========================================================================
    var componentRegistry = Object.create(null);
    var schedulerQueue = [];
    var isFlushingQueue = false;
    var currentActiveEffect = null;
    var globalStore;
    var shouldTriggerEffects = true;
    var resolvedPromise = Promise.resolve();
    
    // Regex for "item in items"
    var loopRegex = /^\s*(.*?)\s+in\s+(.+)\s*$/;

    // =========================================================================
    // 2. ARRAY INSTRUMENTATION (Zero Allocation Forwarding)
    // =========================================================================
    var arrayInstrumentations = {};
    ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].forEach(method => {
        arrayInstrumentations[method] = function () {
            shouldTriggerEffects = false;
            try {
                return Array.prototype[method].apply(this, arguments);
            } finally {
                shouldTriggerEffects = true;
                triggerDependency(this, 'length');
            }
        };
    });

    // =========================================================================
    // 3. REACTIVITY SYSTEM
    // =========================================================================
    var trackDependency = (target, key) => {
        if (currentActiveEffect) {
            var deps = target.__deps;
            if (!deps) {
                // Define hidden property once
                Object.defineProperty(target, '__deps', {
                    value: Object.create(null), writable: true, configurable: true 
                });
                deps = target.__deps;
            }

            var depList = deps[key];
            if (!depList) deps[key] = depList = [];
            
            if (depList.indexOf(currentActiveEffect) === -1) {
                depList.push(currentActiveEffect);
                currentActiveEffect.deps.push(depList);
            }
        }
    };

    var triggerDependency = (target, key) => {
        if (shouldTriggerEffects && target.__deps) {
            var effects = target.__deps[key];
            if (effects) {
                // Snapshot to prevent infinite loops during mutation
                var queue = effects.slice(); 
                var len = queue.length;
                for (var i = 0; i < len; i++) {
                    var effect = queue[i];
                    effect.scheduler ? effect.scheduler(effect) : effect();
                }
            }
        }
    };

    var createEffect = (fn, scheduler) => {
        var runner = () => {
            // Cleanup previous dependencies using O(1) Swap-and-Pop
            if (runner.deps) {
                var len = runner.deps.length;
                for (var i = 0; i < len; i++) {
                    var list = runner.deps[i];
                    var idx = list.indexOf(runner);
                    if (idx !== -1) {
                        var end = list.length - 1;
                        if (idx !== end) list[idx] = list[end]; // Swap with last
                        list.pop(); // Remove last
                    }
                }
                runner.deps.length = 0;
            } else {
                runner.deps = [];
            }
            
            var prev = currentActiveEffect;
            currentActiveEffect = runner;
            try { fn(); } finally { currentActiveEffect = prev; }
        };
        
        runner.scheduler = scheduler;
        runner();
        
        return () => {
            if (runner.deps) {
                var len = runner.deps.length;
                for (var i = 0; i < len; i++) {
                    var list = runner.deps[i];
                    var idx = list.indexOf(runner);
                    if (idx !== -1) {
                        var end = list.length - 1;
                        if (idx !== end) list[idx] = list[end];
                        list.pop();
                    }
                }
            }
        };
    };

    var makeReactive = (obj) => {
        if (!obj || typeof obj !== 'object' || obj.__isProxy || obj instanceof Node) return obj;
        if (obj.__proxy) return obj.__proxy;

        var proxy = new Proxy(obj, {
            get: (target, key, receiver) => {
                if (key === '__raw') return target;
                if (key === '__isProxy') return true;
                if (key === '__deps') return target.__deps;
                if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) return arrayInstrumentations[key];

                trackDependency(target, key);
                var res = Reflect.get(target, key, receiver);
                return (res && typeof res === 'object' && !(res instanceof Node)) ? makeReactive(res) : res;
            },
            set: (target, key, value, receiver) => {
                var old = target[key];
                var isArray = Array.isArray(target);
                var hadKey = isArray ? Number(key) < target.length : Object.prototype.hasOwnProperty.call(target, key);
                
                if (!isArray && !hadKey) {
                    var cursor = Object.getPrototypeOf(target);
                    while (cursor && cursor !== Object.prototype) {
                        if (Object.prototype.hasOwnProperty.call(cursor, key)) {
                            var res = Reflect.set(cursor, key, value);
                            if (shouldTriggerEffects && value !== old) triggerDependency(target, key);
                            return res;
                        }
                        cursor = Object.getPrototypeOf(cursor);
                    }
                }

                var res = Reflect.set(target, key, value, receiver);
                
                if (shouldTriggerEffects) {
                    if (!hadKey) {
                        triggerDependency(target, key);
                        if (isArray) triggerDependency(target, 'length');
                    } else if (value !== old) {
                        triggerDependency(target, key);
                    }
                }
                return res;
            },
            deleteProperty: (target, key) => {
                var hadKey = Object.prototype.hasOwnProperty.call(target, key);
                var res = Reflect.deleteProperty(target, key);
                if (res && hadKey) {
                    triggerDependency(target, key);
                    if (Array.isArray(target)) triggerDependency(target, 'length');
                }
                return res;
            }
        });
        
        Object.defineProperty(obj, '__proxy', { value: proxy, enumerable: false });
        return proxy;
    };

    globalStore = makeReactive({});

    // =========================================================================
    // 4. HELPERS & DOM
    // =========================================================================
    var evaluatePath = (scope, path) => {
        if (path.indexOf('.') === -1) {
            if (scope[path] === undefined) console.warn('Property undefined: ' + path);
            return { value: scope[path], context: scope };
        }

        var parts = path.split('.');
        var val = scope;
        var ctx = scope;
        var len = parts.length;
        for (var i = 0; i < len; i++) {
            if (val == null) {
                console.warn('Property undefined: ' + path);
                return { value: undefined, context: null };
            }
            ctx = val;
            val = val[parts[i]];
        }
        return { value: val, context: ctx };
    };

    var nextTick = (fn) => {
        if (!fn.__queued) {
            fn.__queued = true;
            schedulerQueue.push(fn);
            if (!isFlushingQueue) {
                isFlushingQueue = true;
                resolvedPromise.then(() => {
                    var len = schedulerQueue.length;
                    for (var i = 0; i < len; i++) {
                        var job = schedulerQueue[i];
                        job.__queued = false;
                        job();
                    }
                    schedulerQueue.length = 0;
                    isFlushingQueue = false;
                });
            }
        }
    };

    // Dirty checking included to prevent unnecessary reflows
    var domOperations = {
        text: (el, val) => { 
            val = val == null ? '' : val;
            if (el.textContent !== val) el.textContent = val; 
        },
        html: (el, val) => { 
            val = val == null ? '' : val;
            if (el.innerHTML !== val) el.innerHTML = val; 
        },
        value: (el, val) => {
            if (el.type === 'checkbox') {
                var v = !!val;
                if (el.checked !== v) el.checked = v;
            } else if (el.type === 'radio') {
                var v = el.value == val;
                if (el.checked !== v) el.checked = v;
            } else {
                val = val == null ? '' : val;
                if (el.value != val) {
                    var start = el.selectionStart;
                    var end = el.selectionEnd;
                    el.value = val;
                    if (document.activeElement === el) {
                        try { el.setSelectionRange(start, end); } catch(e) {}
                    }
                }
            }
        },
        attr: (el, val, attr) => {
            if (val == null || val === false) {
                if (el.hasAttribute(attr)) el.removeAttribute(attr);
            } else {
                val = val === true ? '' : String(val);
                if (el.getAttribute(attr) !== val) el.setAttribute(attr, val);
            }
        },
        class: (el, val) => {
            // [UPDATE 1] Support String
            if (typeof val === 'string') {
                if (el.className !== val) el.className = val;
            } else if (val && typeof val === 'object') {
                for (var cls in val) {
                    if (val[cls]) {
                        if (!el.classList.contains(cls)) el.classList.add(cls);
                    } else {
                        if (el.classList.contains(cls)) el.classList.remove(cls);
                    }
                }
            }
        }
    };

    // =========================================================================
    // 5. ENGINE
    // =========================================================================
    var mountComponent = (rootElement, parentScope) => {
        if (rootElement.__isMounted) return;
        rootElement.__isMounted = true;

        var name = rootElement.getAttribute('s-data');
        var factory = componentRegistry[name];
        if (!factory) return;

        // Data & Prototype Inheritance
        var data = factory();
        if (parentScope) Object.setPrototypeOf(data, parentScope);
        
        var state = makeReactive(data);
        state.$refs = {};
        state.$root = rootElement;
        state.$store = globalStore;
        if (parentScope) state.$parent = parentScope;

        var cleanupCallbacks = [];
        var activeListeners = Object.create(null);

        // Global Event Delegation (One listener per event type per component)
        var handleEvent = (e) => {
            var target = e.target;
            
            // s-model
            if (target.__modelPath && (e.type === 'input' || e.type === 'change')) {
                var scope = target.__scope || state;
                var val = target.type === 'checkbox' ? target.checked : target.value;
                var evalRes = evaluatePath(scope, target.__modelPath);
                
                if (evalRes.context) {
                    if (target.__modelPath.indexOf('.') === -1) scope[target.__modelPath] = val;
                    else evalRes.context[target.__modelPath.split('.').pop()] = val;
                }
            }

            // s-[event]
            var hName;
            while (target && target !== rootElement.parentNode) {
                if (target.__handlers && (hName = target.__handlers[e.type])) {
                    var tScope = target.__scope || state;
                    var res = evaluatePath(tScope, hName);
                    if (typeof res.value === 'function') res.value.call(res.context, e);
                }
                target = target.parentNode;
            }
        };

        var addListener = (type) => {
            if (!activeListeners[type]) {
                activeListeners[type] = true;
                rootElement.addEventListener(type, handleEvent);
            }
        };

        var walkDOM = (el, currentScope, cleanupList) => {
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore')) return;

            // Component boundary: recurse with current scope as parent
            if (el !== rootElement && el.hasAttribute('s-data')) {
                var child = mountComponent(el, currentScope);
                if (child) cleanupList.push(child.unmount);
                return;
            }

            var ifAttr = el.getAttribute('s-if');
            var forAttr = !ifAttr && el.tagName === 'TEMPLATE' ? el.getAttribute('s-for') : null;

            // --- s-if ---
            if (ifAttr) {
                var anchor = document.createTextNode('');
                el.replaceWith(anchor);
                var activeEl = null;
                var branchCleanups = [];
                cleanupList.push(() => { branchCleanups.forEach(cb => cb()); });

                return cleanupList.push(createEffect(() => {
                    var val = evaluatePath(currentScope, ifAttr).value;
                    if (val) {
                        if (!activeEl) {
                            activeEl = el.cloneNode(true);
                            activeEl.removeAttribute('s-if');
                            walkDOM(activeEl, currentScope, branchCleanups);
                            anchor.parentNode.insertBefore(activeEl, anchor);
                        }
                    } else if (activeEl) {
                        branchCleanups.forEach(cb => cb());
                        branchCleanups.length = 0;
                        activeEl.remove();
                        activeEl = null;
                    }
                }, nextTick));
            }

            // --- s-for ---
            if (forAttr) {
                var match = forAttr.match(loopRegex);
                if (!match) return;

                var lhs = match[1].replace(/[()]/g, '').split(',');
                var alias = lhs[0].trim();
                var idxAlias = lhs[1] ? lhs[1].trim() : null;
                var listKey = match[2].trim();
                var keyAttr = el.getAttribute('s-key');
                
                var anchor = document.createTextNode('');
                el.replaceWith(anchor);
                var nodePool = Object.create(null);

                cleanupList.push(() => {
                    for(var k in nodePool) nodePool[k].cleanups.forEach(cb => cb());
                });

                return cleanupList.push(createEffect(() => {
                    var items = evaluatePath(currentScope, listKey).value;
                    if (Array.isArray(items)) trackDependency(items, 'length');

                    var fragment = document.createDocumentFragment();
                    var nextPool = Object.create(null);
                    var iterable = items || [];
                    var isArr = Array.isArray(iterable);
                    var keys = isArr ? iterable : Object.keys(iterable);
                    var cursor = anchor;
                    var len = isArr ? iterable.length : keys.length;

                    for (var i = 0; i < len; i++) {
                        var key = isArr ? i : keys[i];
                        var item = isArr ? iterable[i] : iterable[key];
                        var unique = keyAttr && item ? item[keyAttr] : (isArr ? key + '_' + (typeof item==='object'? 'o':item) : key);
                        
                        var row = nodePool[unique];
                        if (row) {
                            row.scope[alias] = item;
                            if (idxAlias) row.scope[idxAlias] = key;
                        } else {
                            var clone = el.content.cloneNode(true);
                            // Inherit Scope via Prototype
                            var rScopeRaw = Object.create(currentScope);
                            rScopeRaw[alias] = item;
                            if (idxAlias) rScopeRaw[idxAlias] = key;
                            
                            var rScope = makeReactive(rScopeRaw);
                            var rNodes = Array.prototype.slice.call(clone.childNodes);
                            var rCleanups = [];
                            for(var n=0; n<rNodes.length; n++) walkDOM(rNodes[n], rScope, rCleanups);
                            row = { nodes: rNodes, scope: rScope, cleanups: rCleanups };
                        }

                        if (row.nodes[0] !== cursor.nextSibling) {
                            for(var n=0; n<row.nodes.length; n++) fragment.appendChild(row.nodes[n]);
                            cursor.parentNode.insertBefore(fragment, cursor.nextSibling);
                        }
                        cursor = row.nodes[row.nodes.length - 1];
                        nextPool[unique] = row;
                        if(nodePool[unique]) delete nodePool[unique];
                    }

                    for(var k in nodePool) {
                        var r = nodePool[k];
                        r.cleanups.forEach(cb => cb());
                        for(var n=0; n<r.nodes.length; n++) r.nodes[n].remove();
                    }
                    nodePool = nextPool;
                }, nextTick));
            }

            // --- Attribute Bindings (Lazy & Merged) ---
            if (el.hasAttributes()) {
                var bindings = null;
                var isInteractive = false;
                var attrs = el.attributes;
                var len = attrs.length;
                
                for (var i = 0; i < len; i++) {
                    var name = attrs[i].name;
                    var val = attrs[i].value;

                    if (name[0] === ':') {
                        if (!bindings) bindings = [];
                        bindings.push({ type: 'attr', name: name.slice(1), path: val });
                    } else if (name[0] === 's' && name[1] === '-') {
                        var type = name.slice(2);
                        if (type === 'ref') {
                            state.$refs[val] = el;
                        } else if (type === 'model') {
                            isInteractive = true;
                            el.__modelPath = val;
                            if (!bindings) bindings = [];
                            bindings.push({ type: 'value', path: val });
                            var evt = (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') ? 'change' : 'input';
                            addListener(evt);
                        } else if (domOperations[type]) {
                            if (!bindings) bindings = [];
                            bindings.push({ type: type, path: val });
                        } else {
                            // Event Handlers
                            isInteractive = true;
                            if (!el.__handlers) el.__handlers = Object.create(null);
                            el.__handlers[type] = val;
                            addListener(type);
                        }
                    }
                }

                if (isInteractive) el.__scope = currentScope;

                if (bindings) {
                    cleanupList.push(createEffect(() => {
                        for (var i = 0; i < bindings.length; i++) {
                            var b = bindings[i];
                            var evalRes = evaluatePath(currentScope, b.path);
                            var res = evalRes.value;
                            var finalVal = typeof res === 'function' ? res.call(evalRes.context, el) : res;
                            
                            if (b.type === 'attr') {
                                b.name === 'class' 
                                    ? domOperations.class(el, finalVal) 
                                    : domOperations.attr(el, finalVal, b.name);
                            } else {
                                domOperations[b.type](el, finalVal);
                            }
                        }
                    }, nextTick));
                }
            }

            // Recursion
            var child = el.firstChild;
            while (child) {
                var next = child.nextSibling;
                walkDOM(child, currentScope, cleanupList);
                child = next;
            }
        };

        walkDOM(rootElement, state, cleanupCallbacks);
        if (state.init) state.init();

        return {
            unmount: () => {
                if (state.destroy) state.destroy.call(state);
                for(var i=0; i<cleanupCallbacks.length; i++) cleanupCallbacks[i]();
                for(var k in activeListeners) rootElement.removeEventListener(k, handleEvent);
                rootElement.__isMounted = false;
            }
        };
    };

    return {
        data: (name, factory) => { componentRegistry[name] = factory; },
        start: () => {
            var els = document.querySelectorAll('[s-data]');
            for (var i = 0; i < els.length; i++) mountComponent(els[i]);
        },
        store: (key, val) => { return val === undefined ? globalStore[key] : (globalStore[key] = val); },
        raw: (obj) => { return (obj && obj.__raw) || obj; }
    };
})();

window.spiki = spiki;
})();
