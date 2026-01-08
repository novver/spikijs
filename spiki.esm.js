var spiki = (() => {
    // --- State & Storage ---
    var componentRegistry = Object.create(null);
    var eventMetadataMap = new WeakMap();
    var dependencyMap = new WeakMap();
    var proxyCache = new WeakMap();
    var pathSplitCache = new Map();
    var schedulerQueue = new Set();

    var loopRegex = /^\s*(.*?)\s+in\s+(.+)\s*$/;

    // --- Global State Variables ---
    var currentActiveEffect;
    var isFlushingQueue;
    var globalStore;
    var shouldTriggerEffects = true;
    var resolvedPromise = Promise.resolve();

    // -------------------------------------------------------------------------
    // 1. Array Interceptors
    // -------------------------------------------------------------------------
    var arrayInstrumentations = {};
    ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse'].forEach(methodName => {
        arrayInstrumentations[methodName] = function () {
            var args = [];
            for (var i = 0; i < arguments.length; i++) {
                args[i] = arguments[i];
            }
            
            shouldTriggerEffects = false;
            try {
                var result = Array.prototype[methodName].apply(this, args);
                return result;
            } finally {
                shouldTriggerEffects = true;
                triggerDependency(this, 'length');
            }
        };
    });

    // -------------------------------------------------------------------------
    // 2. Helper Functions
    // -------------------------------------------------------------------------
    
    var createScope = (parentScope) => {
        var proto = Object.create(parentScope);
        return new Proxy(proto, {
            set: (target, key, value, receiver) => {
                if (target.hasOwnProperty(key)) {
                    return Reflect.set(target, key, value, receiver);
                }
                
                var cursor = target;
                while (cursor && !Object.prototype.hasOwnProperty.call(cursor, key)) {
                    cursor = Object.getPrototypeOf(cursor);
                }
                
                return Reflect.set(cursor || target, key, value);
            }
        });
    };

    var evaluatePath = (scope, path) => {
        if (typeof path !== 'string') return { value: path, context: scope };

        if (path.indexOf('.') === -1) {
            return { value: scope ? scope[path] : undefined, context: scope };
        }

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

    var nextTick = (fn) => {
        return !schedulerQueue.has(fn) && 
               schedulerQueue.add(fn) && 
               !isFlushingQueue && 
               (isFlushingQueue = true) &&
               resolvedPromise.then(() => {
                   schedulerQueue.forEach(job => job());
                   schedulerQueue.clear();
                   isFlushingQueue = false;
               });
    };

    // -------------------------------------------------------------------------
    // 3. Reactivity System
    // -------------------------------------------------------------------------

    var trackDependency = (target, key) => {
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

    var triggerDependency = (target, key) => {
        var depsMap, depSet;
        if (shouldTriggerEffects && (depsMap = dependencyMap.get(target)) && (depSet = depsMap.get(key))) {
            depSet.forEach(effectFn => {
                effectFn.scheduler ? effectFn.scheduler(effectFn) : effectFn();
            });
        }
    };

    var createEffect = (fn, scheduler) => {
        var runner = () => {
            runner.dependencies.forEach(depSet => depSet.delete(runner));
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
        runner();
        
        return () => {
            runner.dependencies.forEach(depSet => depSet.delete(runner));
            runner.dependencies.clear();
            schedulerQueue.delete(runner);
        };
    };

    var makeReactive = (obj) => {
        if (!obj || typeof obj !== 'object' || obj.__isProxy || obj instanceof Node) return obj;
        
        var existingProxy = proxyCache.get(obj);
        if (existingProxy) return existingProxy;

        var proxy = new Proxy(obj, {
            get: (target, key, receiver) => {
                if (key === '__raw') return target;
                if (key === '__isProxy') return true;

                if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
                    return arrayInstrumentations[key];
                }
                
                trackDependency(target, key);
                
                var result = Reflect.get(target, key, receiver);
                return result && typeof result === 'object' && !(result instanceof Node) 
                    ? makeReactive(result) 
                    : result;
            },
            set: (target, key, value, receiver) => {
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
            deleteProperty: (target, key) => {
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
        text: (el, value) => { 
            el.textContent = (value !== null && value !== undefined) ? value : ''; 
        },
        html: (el, value) => { 
            el.innerHTML = (value !== null && value !== undefined) ? value : ''; 
        },
        value: (el, value) => {
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
        attr: (el, value, attributeName) => {
            (value == null || value === false) 
                ? el.removeAttribute(attributeName) 
                : el.setAttribute(attributeName, value === true ? '' : value);
        },
        class: (el, value) => {
            if (typeof value === 'string') {
                value.split(/\s+/).forEach(cls => {
                    if (cls) {
                        var isNegative = cls[0] === '!';
                        var className = isNegative ? cls.slice(1) : cls;
                        el.classList[isNegative ? 'remove' : 'add'](className);
                    }
                });
            }
        },
        init: () => { },
        destroy: () => { }
    };

    // -------------------------------------------------------------------------
    // 5. Engine / Mounting Logic
    // -------------------------------------------------------------------------
    var mountComponent = (rootElement) => {
        if (rootElement.__isMounted) return;
        rootElement.__isMounted = 1;

        var componentName = rootElement.getAttribute('s-data');
        var componentFactory = componentRegistry[componentName];
        if (!componentFactory) return;

        var state = makeReactive(componentFactory());
        state.$refs = {};
        state.$root = rootElement;
        state.$store = globalStore;

        var cleanupCallbacks = [];

        var handleEvent = (e) => {
            var target = e.target;
            
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

        var walkDOM = (el, currentScope, cleanupList) => {
            if (el.nodeType !== 1 || el.hasAttribute('s-ignore')) return;

            if (el !== rootElement && el.hasAttribute('s-data')) {
                var childComponent = mountComponent(el);
                if (childComponent) cleanupList.push(childComponent.unmount);
                return;
            }

            var attributeValue;

            if ((attributeValue = el.getAttribute('s-if'))) {
                var anchor = document.createTextNode('');
                var branchCleanups = [];
                el.replaceWith(anchor);
                var activeNode;

                cleanupList.push(() => { 
                    branchCleanups.forEach(cb => cb()); 
                });

                return cleanupList.push(createEffect(() => {
                    var evaluation = evaluatePath(currentScope, attributeValue);
                    var result = evaluation.value;
                    var context = evaluation.context;
                    
                    var isTruthy = typeof result === 'function' ? result.call(context, el) : result;

                    if (isTruthy) {
                        if (!activeNode) {
                            activeNode = el.cloneNode(true);
                            activeNode.removeAttribute('s-if');
                            walkDOM(activeNode, currentScope, branchCleanups);
                            anchor.parentNode.insertBefore(activeNode, anchor);
                        }
                    } else if (activeNode) {
                        branchCleanups.forEach(cb => cb());
                        branchCleanups.length = 0;
                        activeNode.remove();
                        activeNode = null;
                    }
                }, nextTick));
            }

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

                cleanupList.push(() => {
                    nodePool.forEach(row => {
                        row.cleanups.forEach(cb => cb());
                    });
                });

                return cleanupList.push(createEffect(() => {
                    var evaluation = evaluatePath(currentScope, listKey);
                    var rawItems = evaluation.value;
                    var items = rawItems;
                    
                    if (Array.isArray(items)) trackDependency(items, 'length');

                    var domCursor = anchorForLoop;
                    var iterable = Array.isArray(items) ? items : items ? Object.keys(items) : [];
                    var nextNodePool = new Map();

                    iterable.forEach((rawItem, index) => {
                        var key = Array.isArray(items) ? index : rawItem;
                        var itemValue = Array.isArray(items) ? rawItem : items[rawItem];

                        var rowUniqueKey;
                        if (keyAttribute && itemValue) rowUniqueKey = itemValue[keyAttribute];
                        else rowUniqueKey = (typeof itemValue === 'object' && itemValue) 
                            ? itemValue 
                            : key + '_' + itemValue;

                        var row = nodePool.get(rowUniqueKey);

                        var defineAlias = (targetObj) => {
                            Object.defineProperty(targetObj, itemAlias, {
                                configurable: true, enumerable: true,
                                get: () => items[key],
                                set: (v) => { items[key] = v; }
                            });
                        };

                        if (!row) {
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
                            defineAlias(row.scope);
                            if (indexAlias) row.scope[indexAlias] = key;
                        }

                        if (row.nodes[0] !== domCursor.nextSibling) {
                            var fragment = document.createDocumentFragment();
                            row.nodes.forEach(n => fragment.appendChild(n));
                            domCursor.parentNode.insertBefore(fragment, domCursor.nextSibling);
                        }
                        
                        domCursor = row.nodes[row.nodes.length - 1];
                        nextNodePool.set(rowUniqueKey, row);
                        nodePool.delete(rowUniqueKey);
                    });

                    nodePool.forEach(row => {
                        row.cleanups.forEach(cb => cb());
                        row.nodes.forEach(n => n.remove());
                    });
                    nodePool = nextNodePool;
                }, nextTick));
            }

            var attributes = el.attributes;
            for (var i = attributes.length - 1; i >= 0; i--) {
                ((attr) => {
                    var name = attr.name;
                    var value = attr.value;
                    
                    if (name[0] === ':') {
                        cleanupList.push(createEffect(() => {
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
                            cleanupList.push(createEffect(() => {
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
                            cleanupList.push(createEffect(() => {
                                var evaluation = evaluatePath(currentScope, value);
                                var result = evaluation.value;
                                var context = evaluation.context;
                                domOperations[directiveType](
                                    el, 
                                    typeof result === 'function' ? result.call(context, el) : result
                                );
                            }, nextTick));
                        } else {
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

            var child = el.firstElementChild;
            while (child) {
                var next = child.nextElementSibling;
                walkDOM(child, currentScope, cleanupList);
                child = next;
            }
        };

        walkDOM(rootElement, state, cleanupCallbacks);
        if (state.init) state.init();

        return {
            unmount: () => {
                if (state.destroy) state.destroy.call(state);
                cleanupCallbacks.forEach(cb => cb());
                if (rootElement.__listeningEvents) {
                    rootElement.__listeningEvents.forEach(evt => { 
                        rootElement.removeEventListener(evt, handleEvent); 
                    });
                }
                rootElement.__isMounted = 0;
            }
        };
    };

    return {
        data: (name, factoryFn) => { 
            componentRegistry[name] = factoryFn; 
        },
        start: () => {
            var elements = document.querySelectorAll('[s-data]');
            for (var i = 0; i < elements.length; i++) {
                mountComponent(elements[i]);
            }
        },
        store: (key, value) => { 
            return value === undefined 
                ? globalStore[key] 
                : (globalStore[key] = value); 
        },
        raw: (obj) => {
            return (obj && obj.__raw) || obj;
        }
    };
})();

export default spiki;
