/**
 * SPIKI - Lightweight Binding Framework
 */

(function () {
"use strict";

var spiki = (() => {
    // =========================================================================
    // 1. GLOBAL STATE & UTILITIES
    // =========================================================================
    
    // Internal state
    var componentRegistry = Object.create(null);
    var schedulerQueue = [];
    var isFlushingQueue = false;
    var currentActiveEffect = null;
    var globalStore;
    var shouldTriggerEffects = true; // Flag to pause reactivity during array mutations
    
    // Reusable objects
    var resolvedPromise = Promise.resolve();
    var loopRegex = /^\s*(.*?)\s+in\s+(.+)\s*$/; // Matches: "item in items"

    /**
     * Microtask Scheduler.
     * Batches DOM updates to run once per tick.
     * Uses 'Snapshotting' to prevent infinite loops if an effect triggers itself.
     */
    var nextTick = (fn) => {
        if (!fn.__queued) {
            fn.__queued = true;
            schedulerQueue.push(fn);

            if (!isFlushingQueue) {
                isFlushingQueue = true;
                resolvedPromise.then(() => {
                    // Create a snapshot of the current queue
                    // This prevents new jobs added during flush from causing an infinite loop
                    var queue = schedulerQueue.slice();
                    schedulerQueue.length = 0;
                    isFlushingQueue = false;

                    // Execute jobs
                    for (var i = 0; i < queue.length; i++) {
                        queue[i].__queued = false;
                        queue[i]();
                    }
                });
            }
        }
    };

    /**
     * safely evaluates a dot-notation path string against a scope.
     * Example: evaluatePath(scope, 'user.name')
     */
    var evaluatePath = (scope, path) => {
        // Fast path: direct property access (most common case)
        if (path.indexOf('.') === -1) {
            return { value: scope[path], context: scope };
        }

        // Deep access: walk the object tree
        var parts = path.split('.');
        var val = scope;
        var ctx = scope;
        
        for (var i = 0; i < parts.length; i++) {
            if (val == null){
                console.warn('Property undefined: ' + path);
                return { value: undefined, context: null };
            }
            ctx = val;
            val = val[parts[i]];
        }
        return { value: val, context: ctx };
    };

    // =========================================================================
    // 2. REACTIVITY SYSTEM (Proxy Based)
    // =========================================================================

    // A. Array Instrumentation
    // Intercept mutation methods to trigger updates manually
    var arrayMethods = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'];
    var arrayInstrumentations = {};
    
    arrayMethods.forEach(method => {
        arrayInstrumentations[method] = function () {
            shouldTriggerEffects = false; // Pause triggering while mutating
            try { 
                return Array.prototype[method].apply(this, arguments); 
            } finally { 
                shouldTriggerEffects = true; 
                triggerDependency(this, 'length'); // Trigger update
            }
        };
    });

    // B. Dependency Tracking
    var trackDependency = (target, key) => {
        if (currentActiveEffect) {
            var deps = target.__deps;
            if (!deps) {
                // Define hidden dependency storage
                Object.defineProperty(target, '__deps', { 
                    value: Object.create(null), writable: true 
                });
                deps = target.__deps;
            }

            var list = deps[key] || (deps[key] = []);
            
            // Link effect to dependency if not already linked
            if (list.indexOf(currentActiveEffect) === -1) {
                list.push(currentActiveEffect);
                currentActiveEffect.deps.push(list);
            }
        }
    };

    var triggerDependency = (target, key) => {
        if (shouldTriggerEffects && target.__deps && target.__deps[key]) {
            // Snapshot effects to run
            var queue = target.__deps[key].slice();
            for (var i = 0; i < queue.length; i++) {
                var effect = queue[i];
                effect.scheduler ? effect.scheduler(effect) : effect();
            }
        }
    };

    // Helper: Efficiently remove an effect from its dependencies
    var cleanupEffect = (runner) => {
        if (runner.deps) {
            for (var i = 0; i < runner.deps.length; i++) {
                var list = runner.deps[i];
                var idx = list.indexOf(runner);
                if (idx !== -1) {
                    // Optimized removal: Swap with last item, then pop (O(1))
                    list[idx] = list[list.length - 1];
                    list.pop();
                }
            }
            runner.deps.length = 0;
        }
    };

    // C. Effect Creator
    // Wraps a function to track dependencies during execution
    var createEffect = (fn, scheduler) => {
        var runner = () => {
            cleanupEffect(runner); // Clean old deps before re-run
            var prev = currentActiveEffect;
            currentActiveEffect = runner;
            try { 
                fn(); 
            } finally { 
                currentActiveEffect = prev; 
            }
        };
        runner.deps = [];
        runner.scheduler = scheduler;
        runner(); // Initial run
        return () => cleanupEffect(runner); // Return cleanup function
    };

    // D. Reactive Factory (The core Proxy logic)
    var makeReactive = (obj) => {
        // Return as-is if primitive, already proxy, or DOM node
        if (!obj || typeof obj !== 'object' || obj.__isProxy || obj instanceof Node) return obj;
        if (obj.__proxy) return obj.__proxy;

        var proxy = new Proxy(obj, {
            get: (target, key, receiver) => {
                // System flags
                if (key === '__raw') return target;
                if (key === '__isProxy') return true;
                if (key === '__deps') return target.__deps;
                
                // Intercept Array methods
                if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
                    return arrayInstrumentations[key];
                }

                trackDependency(target, key);
                
                var res = Reflect.get(target, key, receiver);
                // Recursive reactivity (Lazy)
                return (res && typeof res === 'object' && !(res instanceof Node)) 
                    ? makeReactive(res) 
                    : res;
            },
            set: (target, key, value, receiver) => {
                var old = target[key];
                var isArray = Array.isArray(target);
                var hadKey = isArray 
                    ? Number(key) < target.length 
                    : Object.prototype.hasOwnProperty.call(target, key);
                
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

                // Standard Set
                var res = Reflect.set(target, key, value, receiver);
                
                if (shouldTriggerEffects && res) {
                    if (!hadKey || value !== old) {
                        triggerDependency(target, key);
                        if (isArray) triggerDependency(target, 'length');
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
        
        // Cache the proxy
        Object.defineProperty(obj, '__proxy', { value: proxy, enumerable: false });
        return proxy;
    };

    // Initialize Global Store
    globalStore = makeReactive({});

    // =========================================================================
    // 3. DOM OPERATIONS
    // =========================================================================
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
                el.checked = !!val;
            } else if (el.type === 'radio') {
                el.checked = (el.value == val);
            } else {
                val = val == null ? '' : val;
                if (el.value != val) {
                    // Fix: Preserve cursor position while updating value
                    var start = el.selectionStart;
                    var end = el.selectionEnd;
                    el.value = val;
                    if (document.activeElement === el) {
                        try { el.setSelectionRange(start, end); } catch(e) {}
                    }
                }
            }
        },
        attr: (el, val, attrName) => {
            if (val == null || val === false) el.removeAttribute(attrName);
            else el.setAttribute(attrName, val === true ? '' : val);
        },
        class: (el, val) => {
            if (typeof val === 'string') {
                if (el.className !== val) el.className = val;
            } else if (val) {
                // Object syntax: { 'active': true, 'hidden': false }
                for (var cls in val) el.classList.toggle(cls, !!val[cls]);
            }
        },
        effect: () => { }
    };

    // =========================================================================
    // 4. COMPONENT ENGINE
    // =========================================================================
    var mountComponent = (rootElement, parentScope) => {
        if (rootElement.__isMounted) return;
        rootElement.__isMounted = true;

        var name = rootElement.getAttribute('s-data');
        var factory = componentRegistry[name];
        if (!factory) return;

        // Create Component Data
        var data = factory();
        // Inherit Scope via Prototype Chain
        if (parentScope) Object.setPrototypeOf(data, parentScope);
        
        var state = makeReactive(data);
        state.$refs = {};
        state.$root = rootElement;
        state.$store = globalStore;
        state.$parent = parentScope;

        var cleanupCallbacks = [];
        var activeListeners = Object.create(null);

        // --- Event Delegation ---
        var handleEvent = (e) => {
            var target = e.target;
            while (target && target !== rootElement.parentNode) {
                var handlers = target.__handlers && target.__handlers[e.type];
                
                if (handlers) {
                    for (var i = 0; i < handlers.length; i++) {
                        var h = handlers[i];
                        // Case 1: s-model
                        if (h.isModel) {
                            var val = target.type === 'checkbox' ? target.checked : target.value;
                            var res = evaluatePath(target.__scope, h.path);
                            if (res.context) {
                                if (h.path.indexOf('.') === -1) res.context[h.path] = val;
                                else res.context[h.path.split('.').pop()] = val;
                            }
                        } 
                        // Case 2: Standard Event
                        else {
                            var res = evaluatePath(target.__scope, h.path);
                            if (typeof res.value === 'function') res.value.call(res.context, e);
                        }
                    }
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

        // --- DOM Parser (Recursive) ---
        var walkDOM = (el, currentScope, cleanupList) => {
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore')) return;

            // 1. Nested Component Check
            if (el !== rootElement && el.hasAttribute('s-data')) {
                var child = mountComponent(el, currentScope);
                if (child) cleanupList.push(child.unmount);
                return;
            }

            var ifAttr = el.getAttribute('s-if');
            // Check for s-for on <template> specifically, or normal elements
            var forAttr = !ifAttr && el.tagName === 'TEMPLATE' && el.getAttribute('s-for');

            // 2. Handle s-if (Conditional Rendering)
            if (ifAttr) {
                var anchor = document.createTextNode('');
                el.replaceWith(anchor);
                
                var activeEl = null;
                var branchCleanups = [];
                
                cleanupList.push(() => branchCleanups.forEach(cb => cb()));

                return cleanupList.push(createEffect(() => {
                    var shouldRender = evaluatePath(currentScope, ifAttr).value;
                    
                    if (shouldRender) {
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

            // 3. Handle s-for (List Rendering)
            if (forAttr) {
                var match = forAttr.match(loopRegex);
                if (match) {
                    var lhs = match[1].split(',').map(s => s.trim().replace(/[()]/g, ''));
                    var alias = lhs[0], idxAlias = lhs[1];
                    var listKey = match[2].trim();
                    var keyAttr = el.getAttribute('s-key');
                    
                    var anchor = document.createTextNode('');
                    el.replaceWith(anchor);
                    var nodePool = Object.create(null); // Cache for DOM nodes

                    cleanupList.push(() => {
                        for(var k in nodePool) nodePool[k].cleanups.forEach(cb => cb());
                    });

                    return cleanupList.push(createEffect(() => {
                        var items = evaluatePath(currentScope, listKey).value || [];
                        if (Array.isArray(items)) trackDependency(items, 'length');

                        var fragment = document.createDocumentFragment();
                        var nextPool = Object.create(null);
                        
                        var isArr = Array.isArray(items);
                        var keys = isArr ? items : Object.keys(items);
                        var len = isArr ? items.length : keys.length;
                        var cursor = anchor;

                        for (var i = 0; i < len; i++) {
                            var key = isArr ? i : keys[i];
                            var item = isArr ? items[i] : items[key];
                            
                            // Key Strategy: Use s-key if provided, otherwise fallback to index + content hash
                            var unique = (keyAttr && item) 
                                ? item[keyAttr] 
                                : (isArr ? String(key) + '_' + (typeof item === 'object' ? 'o' : String(item)) : key);
                            
                            var row = nodePool[unique];
                            
                            if (row) {
                                // Update existing row
                                row.scope[alias] = item;
                                if (idxAlias) row.scope[idxAlias] = key;
                            } else {
                                // Create new row
                                var clone = el.content.cloneNode(true);
                                var rScope = makeReactive(Object.create(currentScope)); // Inherit scope
                                rScope[alias] = item;
                                if (idxAlias) rScope[idxAlias] = key;
                                
                                var rCleanups = [];
                                var rNodes = Array.prototype.slice.call(clone.childNodes);
                                
                                for (var n = 0; n < rNodes.length; n++) walkDOM(rNodes[n], rScope, rCleanups);
                                row = { nodes: rNodes, scope: rScope, cleanups: rCleanups };
                            }

                            // Reorder DOM if necessary
                            if (row.nodes[0] !== cursor.nextSibling) {
                                for (var n = 0; n < row.nodes.length; n++) fragment.appendChild(row.nodes[n]);
                                cursor.parentNode.insertBefore(fragment, cursor.nextSibling);
                            }
                            cursor = row.nodes[row.nodes.length - 1];
                            nextPool[unique] = row;
                            if (nodePool[unique]) delete nodePool[unique];
                        }

                        // Cleanup removed items
                        for (var k in nodePool) {
                            nodePool[k].cleanups.forEach(cb => cb());
                            for (var n = 0; n < nodePool[k].nodes.length; n++) nodePool[k].nodes[n].remove();
                        }
                        nodePool = nextPool;
                    }, nextTick));
                }
                return;
            }

            // 4. Handle Attributes & Bindings
            if (el.hasAttributes()) {
                var bindings = [];
                var attrs = el.attributes;
                var len = attrs.length;
                
                for (var i = 0; i < len; i++) {
                    var name = attrs[i].name;
                    var val = attrs[i].value;

                    // A. Bindings (:src, :class, etc)
                    if (name[0] === ':') { 
                        bindings.push({ type: 'attr', name: name.slice(1), path: val });
                    } 
                    // B. Directives (s-text, s-model, s-click, etc)
                    else if (name[0] === 's' && name[1] === '-') {
                        var type = name.slice(2);
                        if (type === 'data') continue;
                        if (type === 'init') {
                            var res = evaluatePath(currentScope, val);
                            if (typeof res.value === 'function') {
                                nextTick(() => res.value.call(res.context, el));
                            }
                            continue;
                        }
                        if (type in domOperations) {
                            bindings.push({ type: type, path: val });
                        } 
                        else if (type === 'model') {
                            bindings.push({ type: 'value', path: val });
                            el.__modelPath = val; 
                            el.__scope = currentScope;
                            if (!el.__handlers) el.__handlers = {}; // Object map
                            
                            var evt = (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') 
                                ? 'change' : 'input';
                            
                            if (!el.__handlers[evt]) el.__handlers[evt] = [];
                            el.__handlers[evt].unshift({ isModel: true, path: val });
                            
                            addListener(evt);
                        } 
                        else if (type === 'ref') {
                            state.$refs[val] = el;
                        }
                        else {
                            // Event Listeners
                            el.__scope = currentScope;
                            if (!el.__handlers) el.__handlers = {};
                            
                            if (!el.__handlers[type]) el.__handlers[type] = [];
                            el.__handlers[type].push({ path: val });
                            
                            addListener(type);
                        }
                    }

                }

                // Register Effects for Bindings
                if (bindings.length) {
                    cleanupList.push(createEffect(() => {
                        for (var i = 0; i < bindings.length; i++) {
                            var binding = bindings[i];
                            var res = evaluatePath(currentScope, binding.path);
                            // Evaluate value (execute if function)
                            var finalVal = (res.value && typeof res.value === 'function') 
                                ? res.value.call(res.context, el) 
                                : res.value;
                            
                            if (binding.type === 'attr') {
                                binding.name === 'class' 
                                    ? domOperations.class(el, finalVal) 
                                    : domOperations.attr(el, finalVal, binding.name);
                            } else {
                                domOperations[binding.type](el, finalVal);
                            }
                        }
                    }, nextTick));
                }
            }

            // Recurse to children
            var child = el.firstChild;
            while (child) {
                var next = child.nextSibling;
                walkDOM(child, currentScope, cleanupList);
                child = next;
            }
        };

        // Initialize
        walkDOM(rootElement, state, cleanupCallbacks);
        if (state.init) state.init();

        return {
            unmount: () => {
                if (state.destroy) state.destroy.call(state);
                cleanupCallbacks.forEach(cb => cb());
                for (var k in activeListeners) rootElement.removeEventListener(k, handleEvent);
                rootElement.__isMounted = false;
            }
        };
    };

    // =========================================================================
    // 5. PUBLIC API
    // =========================================================================
    return {
        data: (name, factory) => { componentRegistry[name] = factory; },
        start: () => {
            var els = document.querySelectorAll('[s-data]');
            for (var i = 0; i < els.length; i++) mountComponent(els[i]);
        },
        store: (key, val) => val === undefined ? globalStore[key] : (globalStore[key] = val),
        raw: (obj) => (obj && obj.__raw) || obj
    };
})();

window.spiki = spiki;
})();
