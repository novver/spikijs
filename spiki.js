(function () {
"use strict";

var spiki = (function () {
    // --- State & Storage ---
    var componentRegistry = Object.create(null);
    var eventMetadataMap = new WeakMap();
    var dependencyMap = new WeakMap(); // Stores dependencies for reactivity
    var proxyCache = new WeakMap();    // Prevents creating multiple proxies for the same object
    var pathSplitCache = new Map();    // Caches split string paths (e.g., "user.name" -> ["user", "name"])
    var schedulerQueue = new Set();    // Queue for async updates

    var loopRegex = /^\s*(.*?)\s+in\s+(.+)\s*$/; // Regex for 's-for="item in items"'

    // --- Global State Variables ---
    var currentActiveEffect;
    var isFlushingQueue;
    var globalStore;
    var shouldTriggerEffects = true;
    var resolvedPromise = Promise.resolve();

    // -------------------------------------------------------------------------
    // 1. Array Interceptors
    // -------------------------------------------------------------------------
    // We override array methods (push, pop, etc.) to trigger reactivity when arrays change.
    var arrayInstrumentations = {};
    ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].forEach(function (methodName) {
        arrayInstrumentations[methodName] = function () {
            var args = [];
            for (var i = 0; i < arguments.length; i++) {
                args[i] = arguments[i];
            }
            
            // Pause triggering while applying the native method
            shouldTriggerEffects = false;
            try {
                var result = Array.prototype[methodName].apply(this, args);
                return result;
            } finally {
                // Resume triggering and notify listeners of length change
                shouldTriggerEffects = true;
                triggerDependency(this, 'length');
            }
        };
    });

    // -------------------------------------------------------------------------
    // 2. Helper Functions
    // -------------------------------------------------------------------------
    
    // Creates a new scope that inherits from a parent scope. 
    // Uses a Proxy to ensure setting a variable updates the original source in the prototype chain.
    var createScope = function (parentScope) {
        var proto = Object.create(parentScope);
        return new Proxy(proto, {
            set: function (target, key, value, receiver) {
                if (target.hasOwnProperty(key)) {
                    return Reflect.set(target, key, value, receiver);
                }
                
                // Look up the prototype chain to find where the key really exists
                var cursor = target;
                while (cursor && !Object.prototype.hasOwnProperty.call(cursor, key)) {
                    cursor = Object.getPrototypeOf(cursor);
                }
                
                // Set the value on the found source or fallback to the current target
                return Reflect.set(cursor || target, key, value);
            }
        });
    };

    // Resolves a string path (e.g., "user.address.city") against a scope object.
    var evaluatePath = function (scope, path) {
        if (typeof path !== 'string') return { value: path, context: scope };

        if (path.indexOf('.') === -1) {
            return { value: scope ? scope[path] : undefined, context: scope };
        }

        // Cache the split path to improve performance
        var parts = pathSplitCache.get(path);
        if (!parts) {
            if (pathSplitCache.size > 1000) pathSplitCache.clear();
            parts = path.split('.');
            pathSplitCache.set(path, parts);
        }

        var currentValue = scope;
        var currentContext = scope;
        
        for (var i = 0; i < parts.length; i++) {
            var part = parts[i];
            if (currentValue == null) {
                return { value: currentValue, context: null };
            }
            currentContext = currentValue;
            currentValue = currentValue[part];
        }
        return { value: currentValue, context: currentContext };
    };

    // Schedules a function to run in the next microtask (async).
    var nextTick = function (fn) {
        return !schedulerQueue.has(fn) && 
               schedulerQueue.add(fn) && 
               !isFlushingQueue && 
               (isFlushingQueue = true) &&
               resolvedPromise.then(function () {
                   schedulerQueue.forEach(function (job) { job(); });
                   schedulerQueue.clear();
                   isFlushingQueue = false;
               });
    };

    // -------------------------------------------------------------------------
    // 3. Reactivity System
    // -------------------------------------------------------------------------

    // Tracks dependencies: Associates the current active effect with a target object and key.
    var trackDependency = function (target, key) {
        if (!currentActiveEffect) return;
        
        var depsMap = dependencyMap.get(target);
        if (!depsMap) {
            depsMap = new Map();
            dependencyMap.set(target, depsMap);
        }
        
        var depSet = depsMap.get(key);
        if (!depSet) {
            depSet = new Set();
            depsMap.set(key, depSet);
        }
        
        depSet.add(currentActiveEffect);
        currentActiveEffect.dependencies.add(depSet);
    };

    // Triggers effects: Runs all effects associated with a target object and key.
    var triggerDependency = function (target, key) {
        var depsMap, depSet;
        if (shouldTriggerEffects && (depsMap = dependencyMap.get(target)) && (depSet = depsMap.get(key))) {
            depSet.forEach(function (effectFn) {
                // If the effect has a custom scheduler, use it; otherwise run immediately
                effectFn.scheduler ? effectFn.scheduler(effectFn) : effectFn();
            });
        }
    };

    // Creates a reactive effect wrapper around a function.
    var createEffect = function (fn, scheduler) {
        var runner = function () {
            // Clean up old dependencies before re-running
            runner.dependencies.forEach(function (depSet) { depSet.delete(runner); });
            runner.dependencies.clear();
            
            var previousEffect = currentActiveEffect;
            currentActiveEffect = runner;
            try { 
                fn(); 
            } finally { 
                currentActiveEffect = previousEffect; 
            }
        };
        
        runner.dependencies = new Set();
        runner.scheduler = scheduler;
        
        // Run immediately
        runner();
        
        // Return a cleanup function
        return function () {
            runner.dependencies.forEach(function (depSet) { depSet.delete(runner); });
            runner.dependencies.clear();
            schedulerQueue.delete(runner);
        };
    };

    // Makes an object reactive using Proxy.
    var makeReactive = function (obj) {
        if (!obj || typeof obj !== 'object' || obj.__isProxy || obj instanceof Node) return obj;
        
        var existingProxy = proxyCache.get(obj);
        if (existingProxy) return existingProxy;

        var proxy = new Proxy(obj, {
            get: function (target, key, receiver) {
                // Internal flags
                if (key === '__raw') return target; // Access to original object
                if (key === '__isProxy') return true;

                if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
                    return arrayInstrumentations[key];
                }
                
                trackDependency(target, key);
                
                var result = Reflect.get(target, key, receiver);
                // Recursively make nested objects reactive
                return result && typeof result === 'object' && !(result instanceof Node) 
                    ? makeReactive(result) 
                    : result;
            },
            set: function (target, key, value, receiver) {
                var oldValue = target[key];
                var hadKey = Array.isArray(target) 
                    ? Number(key) < target.length 
                    : Object.prototype.hasOwnProperty.call(target, key);
                
                var result = Reflect.set(target, key, value, receiver);
                
                if (shouldTriggerEffects) {
                    if (!hadKey) {
                        triggerDependency(target, key);
                        if (Array.isArray(target)) triggerDependency(target, 'length');
                    } else if (oldValue !== value) {
                        triggerDependency(target, key);
                    }
                }
                return result;
            },
            deleteProperty: function (target, key) {
                var hadKey = Object.prototype.hasOwnProperty.call(target, key);
                var result = Reflect.deleteProperty(target, key);
                if (result && hadKey) {
                    triggerDependency(target, key);
                    if (Array.isArray(target)) triggerDependency(target, 'length');
                }
                return result;
            }
        });
        
        proxyCache.set(obj, proxy);
        return proxy;
    };

    globalStore = makeReactive({});

    // -------------------------------------------------------------------------
    // 4. DOM Operations
    // -------------------------------------------------------------------------
    var domOperations = {
        text: function (el, value) { 
            el.textContent = (value !== null && value !== undefined) ? value : ''; 
        },
        html: function (el, value) { 
            el.innerHTML = (value !== null && value !== undefined) ? value : ''; 
        },
        value: function (el, value) {
            if (el.type === 'checkbox') {
                el.checked = !!value;
            } else if (el.type === 'radio' && el.name) {
                el.checked = el.value == value;
            } else {
                if (el.value != value) {
                    el.value = (value !== null && value !== undefined) ? value : '';
                }
            }
        },
        attr: function (el, value, attributeName) {
            (value == null || value === false) 
                ? el.removeAttribute(attributeName) 
                : el.setAttribute(attributeName, value === true ? '' : value);
        },
        class: function (el, value) {
            if (typeof value === 'string') {
                value.split(/\s+/).forEach(function (cls) {
                    if (cls) {
                        var isNegative = cls[0] === '!';
                        var className = isNegative ? cls.slice(1) : cls;
                        el.classList[isNegative ? 'remove' : 'add'](className);
                    }
                });
            }
        },
        init: function () { },
        destroy: function () { }
    };

    // -------------------------------------------------------------------------
    // 5. Engine / Mounting Logic
    // -------------------------------------------------------------------------
    var mountComponent = function (rootElement) {
        if (rootElement.__isMounted) return;
        rootElement.__isMounted = 1;

        var componentName = rootElement.getAttribute('s-data');
        var componentFactory = componentRegistry[componentName];
        if (!componentFactory) return;

        // Create reactive state
        var state = makeReactive(componentFactory());
        state.$refs = {};
        state.$root = rootElement;
        state.$store = globalStore;

        var cleanupCallbacks = [];

        // Global Event Handler for this component
        var handleEvent = function (e) {
            var target = e.target;
            
            // Handle Two-Way Binding (Input/Change events)
            if (target.__modelPath && (e.type === 'input' || e.type === 'change')) {
                var path = target.__modelPath;
                var value = target.type === 'checkbox' ? target.checked : target.value;
                var evaluation = evaluatePath(target.__scope || state, path);
                var parentObject = evaluation.context;

                if (path.indexOf('.') === -1) {
                    (target.__scope || state)[path] = value;
                } else if (parentObject) {
                    var parts = path.split('.');
                    parentObject[parts[parts.length - 1]] = value;
                }
            }

            // Handle Event Listeners (e.g., s-click)
            var handlerName;
            while (target && target !== rootElement.parentNode) {
                var meta = eventMetadataMap.get(target);
                if (meta && (handlerName = meta[e.type])) {
                    var evalResult = evaluatePath(target.__scope || state, handlerName);
                    var handlerFn = evalResult.value;
                    var handlerContext = evalResult.context;
                    
                    if (typeof handlerFn === 'function') {
                        handlerFn.call(handlerContext, e);
                    }
                }
                target = target.parentNode;
            }
        };

        // Recursive function to traverse DOM
        var walkDOM = function (el, currentScope, cleanupList) {
            // Skip non-element nodes or ignored elements
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore')) return;

            // Check for nested components
            if (el !== rootElement && el.hasAttribute('s-data')) {
                var childComponent = mountComponent(el);
                if (childComponent) cleanupList.push(childComponent.unmount);
                return;
            }

            var attributeValue;

            // Handle s-if (Conditional Rendering)
            if ((attributeValue = el.getAttribute('s-if'))) {
                var anchor = document.createTextNode('');
                var branchCleanups = [];
                el.replaceWith(anchor);
                var activeNode;

                // Cleanup hook
                cleanupList.push(function () { 
                    branchCleanups.forEach(function (cb) { cb(); }); 
                });

                return cleanupList.push(createEffect(function () {
                    var evaluation = evaluatePath(currentScope, attributeValue);
                    var result = evaluation.value;
                    var context = evaluation.context;
                    
                    // Allow calling functions in s-if
                    var isTruthy = typeof result === 'function' ? result.call(context, el) : result;

                    if (isTruthy) {
                        if (!activeNode) {
                            activeNode = el.cloneNode(true);
                            activeNode.removeAttribute('s-if');
                            walkDOM(activeNode, currentScope, branchCleanups);
                            anchor.parentNode.insertBefore(activeNode, anchor);
                        }
                    } else if (activeNode) {
                        branchCleanups.forEach(function (cb) { cb(); });
                        branchCleanups.length = 0;
                        activeNode.remove();
                        activeNode = null;
                    }
                }, nextTick));
            }

            // Handle s-for (List Rendering)
            if (el.tagName === 'TEMPLATE' && (attributeValue = el.getAttribute('s-for'))) {
                var match = attributeValue.match(loopRegex);
                if (!match) return;
                
                var leftHandSide = match[1].replace(/[()]/g, '');
                var listKey = match[2];
                var splitLhs = leftHandSide.split(',');
                var itemAlias = splitLhs[0].trim();
                var indexAlias = splitLhs[1] ? splitLhs[1].trim() : null;

                var keyAttribute = el.getAttribute('s-key');
                var anchorForLoop = document.createTextNode('');
                el.replaceWith(anchorForLoop);
                
                var nodePool = new Map();

                cleanupList.push(function () {
                    nodePool.forEach(function (row) {
                        row.cleanups.forEach(function (cb) { cb(); });
                    });
                });

                return cleanupList.push(createEffect(function () {
                    var evaluation = evaluatePath(currentScope, listKey);
                    var rawItems = evaluation.value;
                    var items = rawItems;
                    
                    // Ensure we react to array length changes
                    if (Array.isArray(items)) trackDependency(items, 'length');

                    var domCursor = anchorForLoop;
                    var iterable = Array.isArray(items) ? items : items ? Object.keys(items) : [];
                    var nextNodePool = new Map();

                    iterable.forEach(function (rawItem, index) {
                        var key = Array.isArray(items) ? index : rawItem;
                        var itemValue = Array.isArray(items) ? rawItem : items[rawItem];

                        // Determine unique key for DOM reuse
                        var rowUniqueKey;
                        if (keyAttribute && itemValue) rowUniqueKey = itemValue[keyAttribute];
                        else rowUniqueKey = (typeof itemValue === 'object' && itemValue) 
                            ? itemValue 
                            : key + '_' + itemValue;

                        var row = nodePool.get(rowUniqueKey);

                        // Helper to bind the alias (e.g., 'item') to the live array index
                        var defineAlias = function (targetObj) {
                            Object.defineProperty(targetObj, itemAlias, {
                                configurable: true, enumerable: true,
                                get: function () { return items[key]; },
                                set: function (v) { items[key] = v; }
                            });
                        };

                        if (!row) {
                            // Create new row
                            var clone = el.content.cloneNode(true);
                            var rowScope = createScope(currentScope);
                            var rowCleanups = [];

                            defineAlias(rowScope);
                            if (indexAlias) rowScope[indexAlias] = key;

                            var rowNodes = [];
                            var childNode = clone.firstChild;
                            while (childNode) {
                                rowNodes.push(childNode);
                                var nextSibling = childNode.nextSibling;
                                walkDOM(childNode, rowScope, rowCleanups);
                                childNode = nextSibling;
                            }
                            row = { nodes: rowNodes, scope: rowScope, cleanups: rowCleanups };
                        } else {
                            // Update existing row
                            defineAlias(row.scope);
                            if (indexAlias) row.scope[indexAlias] = key;
                        }

                        // Reorder DOM if necessary
                        if (row.nodes[0] !== domCursor.nextSibling) {
                            var fragment = document.createDocumentFragment();
                            row.nodes.forEach(function (n) { fragment.appendChild(n); });
                            domCursor.parentNode.insertBefore(fragment, domCursor.nextSibling);
                        }
                        
                        domCursor = row.nodes[row.nodes.length - 1];
                        nextNodePool.set(rowUniqueKey, row);
                        nodePool.delete(rowUniqueKey);
                    });

                    // Remove items no longer in list
                    nodePool.forEach(function (row) {
                        row.cleanups.forEach(function (cb) { cb(); });
                        row.nodes.forEach(function (n) { n.remove(); });
                    });
                    nodePool = nextNodePool;
                }, nextTick));
            }

            // Process regular attributes
            var attributes = el.attributes;
            for (var i = attributes.length - 1; i >= 0; i--) {
                (function (attr) {
                    var name = attr.name;
                    var value = attr.value;
                    
                    // Handle Bound Attributes (e.g., :class="...")
                    if (name[0] === ':') {
                        cleanupList.push(createEffect(function () {
                            var evaluation = evaluatePath(currentScope, value);
                            var result = evaluation.value;
                            var context = evaluation.context;
                            var opName = name.slice(1) === 'class' ? 'class' : 'attr';
                            
                            domOperations[opName](
                                el, 
                                typeof result === 'function' ? result.call(context, el) : result, 
                                name.slice(1)
                            );
                        }, nextTick));
                        
                    } else if (name[0] === 's' && name[1] === '-') {
                        var directiveType = name.slice(2);
                        
                        if (directiveType === 'ref') {
                            state.$refs[value] = el;
                        } else if (directiveType === 'model') {
                            // s-model Logic
                            cleanupList.push(createEffect(function () {
                                var evaluation = evaluatePath(currentScope, value);
                                domOperations.value(el, evaluation.value);
                            }, nextTick));
                            
                            if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
                                el.__scope = currentScope; 
                                el.__modelPath = value;
                                var eventType = (el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT') 
                                    ? 'change' 
                                    : 'input';
                                    
                                if (!rootElement.__listeningEvents) rootElement.__listeningEvents = new Set();
                                if (!rootElement.__listeningEvents.has(eventType)) {
                                    rootElement.__listeningEvents.add(eventType);
                                    rootElement.addEventListener(eventType, handleEvent);
                                }
                            }
                        } else if (domOperations[directiveType]) {
                            // Native operations like s-text, s-html
                            cleanupList.push(createEffect(function () {
                                var evaluation = evaluatePath(currentScope, value);
                                var result = evaluation.value;
                                var context = evaluation.context;
                                domOperations[directiveType](
                                    el, 
                                    typeof result === 'function' ? result.call(context, el) : result
                                );
                            }, nextTick));
                        } else {
                            // Event Handlers (e.g., s-click)
                            el.__scope = currentScope;
                            var meta = eventMetadataMap.get(el);
                            if (!meta) {
                                meta = {};
                                eventMetadataMap.set(el, meta);
                            }
                            meta[directiveType] = value;
                            
                            if (!rootElement.__listeningEvents) rootElement.__listeningEvents = new Set();
                            if (!rootElement.__listeningEvents.has(directiveType)) {
                                rootElement.__listeningEvents.add(directiveType);
                                rootElement.addEventListener(directiveType, handleEvent);
                            }
                        }
                    }
                })(attributes[i]);
            }

            // Recurse children
            var child = el.firstElementChild;
            while (child) {
                var next = child.nextElementSibling;
                walkDOM(child, currentScope, cleanupList);
                child = next;
            }
        };

        // Start DOM walk
        walkDOM(rootElement, state, cleanupCallbacks);
        if (state.init) state.init();

        // Return API to control component
        return {
            unmount: function () {
                if (state.destroy) state.destroy.call(state);
                cleanupCallbacks.forEach(function (cb) { cb(); });
                if (rootElement.__listeningEvents) {
                    rootElement.__listeningEvents.forEach(function (evt) { 
                        rootElement.removeEventListener(evt, handleEvent); 
                    });
                }
                rootElement.__isMounted = 0;
            }
        };
    };

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------
    return {
        data: function (name, factoryFn) { 
            componentRegistry[name] = factoryFn; 
        },
        start: function () {
            var elements = document.querySelectorAll('[s-data]');
            for (var i = 0; i < elements.length; i++) {
                mountComponent(elements[i]);
            }
        },
        store: function (key, value) { 
            return value === undefined 
                ? globalStore[key] 
                : (globalStore[key] = value); 
        },
        // Unwraps a reactive proxy to return the original object
        raw: function (obj) {
            return (obj && obj.__raw) || obj;
        }
    };
})();

window.spiki = spiki;
})();
