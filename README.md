# Spikijs

Spikijs is a lightweight (~5KB), high-performance JavaScript framework for building interactive interfaces. It works directly with your HTML (no build step required) and uses ES6 Proxies for reactive state management.

It is designed to be simple, secure (CSP Compliant), and fast.

## Key Features

* **Tiny Footprint:** Around 5KB gzip. No complex bundlers needed.
* **Zero Inline Logic:** You cannot write JavaScript logic in HTML attributes (e.g., `count++` is forbidden). This enforces clean separation of concerns and complies with strict Content Security Policies (CSP).
* **Deep Reactivity:** Automatically tracks changes in nested objects and arrays using Proxies.
* **Memory Safe:** Explicit `mount()` and `unmount()` methods prevent memory leaks in Single Page Applications.

---

## Installation & Usage

### Option 1: CDN (Browser)
Simply add the script tag to your HTML. Spiki will automatically attach to `window.spiki`.

```html
<script src="https://unpkg.com/spikijs"></script>

```

### Option 2: NPM (Module)

Install via package manager.

```bash
npm install spikijs

```

```javascript
import spiki from 'spikijs';

// Automatically mount all elements with 's-data'
spiki.start();

```

### Option 3: Manual Mount

You can mount and unmount components manually to manage memory.

```javascript
import spiki from 'spikijs';

// 1. Select the DOM element
const container = document.getElementById('app');

// 2. Mount Spiki to this specific element
const component = spiki.mount(container);


// 3. Unmount to free memory (Stop watchers and event listeners)
// component.unmount();

```

---

## Quick Start

1. **Define HTML**: Add `s-data` to a container.
2. **Define Logic**: Use `spiki.data()`.
3. **Start Engine**: Call `spiki.start()`.

```html
<div s-data="counterApp">
    <h1>Count: <span s-text="count"></span></h1>
    <button s-click="increment">Add +1</button>
    <button s-click="decrement">Del -1</button>
</div>

<script src="https://unpkg.com/spikijs"></script>
<script>
    // 1. Register Component
    spiki.data('counterApp', () => ({
        count: 0,
        increment() {
            this.count++;
        },
        decrement() {
            this.count--;
        }
    }));

    // 2. Start Spiki
    document.addEventListener('DOMContentLoaded', () => {
        spiki.start();
    });
</script>

```

---

## Directives Reference

| Directive | Description | Example |
| --- | --- | --- |
| **`s-data`** | Defines component scope. | `<div s-data="app">` |
| **`s-text`** | Sets text content (Safe). | `<span s-text="msg">` |
| **`s-html`** | Sets innerHTML (Use carefully). | `<div s-html="htmlContent">` |
| **`s-if`** | Conditional rendering. | `<p s-if="showMe">` |
| **`s-for`** | Loops content (requires `<template>`). | `<template s-for="item in list">` |
| **`s-key`** | Unique key for loops (Performance). | `<template ... s-key="id">` |
| **`s-model`** | Two-way binding (Inputs). | `<input s-model="text">` |
| **`s-value`** | One-way value binding. | `<input s-value="text">` |
| **`s-effect`** | Runs function on data change. | `<div s-effect="autoSave">` |
| **`s-ref`** | Stores DOM reference in `$refs`. | `<input s-ref="myInput">` |
| **`s-init`** | Runs on mount. | `<div s-init="onLoad">` |
| **`s-destroy`** | Runs on unmount. | `<div s-destroy="onRemove">` |
| **`s-ignore`** | Skips compilation (Static content). | `<div s-ignore>` |
| **`:[attr]`** | Dynamic attribute binding. | `<img :src="imgUrl">` |
| **`:class`** | Dynamic class toggling. | `<div :class="classConfig">` |
| **`s-[event]`** | Event listener. | `<button s-click="save">` |

---

## Detailed Usage Examples

### 1. Displaying Data (`s-text`)

Updates the `textContent` of an element. This is safe and prevents XSS attacks.

```html
<div s-data="textApp">
    <p>Message: <span s-text="msg"></span></p>
    
    <p>Formatted: <span s-text="formatMsg"></span></p>
</div>

<script>
spiki.data('textApp', () => ({
    msg: 'hello world',
    
    // Function receives the element as argument
    formatMsg(el) {
        // You can manipulate 'el' if needed, but return value is used for text
        return this.msg.toUpperCase();
    }
}));
</script>

```

> **Note:** If you bind a function to `s-text`, that function receives the DOM element (`el`) as its first argument.

### 2. Inner HTML (`s-html`)

Updates the `innerHTML`. Only use this if you trust the content source.

```html
<div s-data="htmlApp">
    <div s-html="rawHtml"></div>
</div>

<script>
spiki.data('htmlApp', () => ({
    rawHtml: '<b>Bold Text</b> and <i>Italic</i>'
}));
</script>

```

> **Note:** Just like `s-text`, if you use a function here, it receives the DOM element (`el`) as an argument.

### 3. Dynamic Attributes (`:[attribute]`)

You can bind ANY HTML attribute to a variable by adding a colon `:` before the attribute name.

```html
<div s-data="attrApp">
    <img :src="avatarUrl" :alt="avatarAlt">
    <a :href="profileLink">View Profile</a>
    
    <button :disabled="checkStatus">Submit</button>
</div>

<script>
spiki.data('attrApp', () => ({
    avatarUrl: 'https://via.placeholder.com/150',
    avatarAlt: 'User Avatar',
    profileLink: '/profile/user1',
    isLoading: true,
    
    checkStatus(el) {
        // 'el' is the button element
        if (this.isLoading) {
            el.style.opacity = '0.5'; // You can touch DOM directly
            return true; // Return value sets the attribute
        }
        el.style.opacity = '1';
        return false;
    }
}));
</script>

```

> **Note:** The function receives the DOM element (`el`) as an argument. You can use this to perform direct DOM manipulation alongside setting the attribute.

### 4. Initialization (`s-init`)

Runs a function immediately when the component is mounted. This is the perfect place for API calls or setting up 3rd party libraries.

```html
<div s-data="usersApp" s-init="loadUsers">
    <p s-if="isLoading">Loading...</p>
    <ul>
        <template s-for="user in users" s-key="id">
            <li><span s-text="user.name"></span></li>
        </template>
    </ul>
</div>

<script>
spiki.data('usersApp', () => ({
    isLoading: true,
    users: [],
    
    loadUsers(el) {
        // 'el' is the div containing s-init
        console.log("Component mounted on:", el);
        
        var self = this;
        fetch('https://jsonplaceholder.typicode.com/users')
            .then(function(r) { return r.json() })
            .then(function(data) {
                self.users = data;
                self.isLoading = false;
            });
    }
}));
</script>

```

> **Note:** The function receives the element (`el`) where the directive is placed.

### 5. Event Listeners (`s-[event]`)

Listen to any DOM event using the `s-` prefix.

```html
<div s-data="eventApp">
    <button s-click="handleClick">Click Me</button>
</div>

<script>
spiki.data('eventApp', () => ({
    handleClick(e) {
        // 'e' is the standard Native Event Object
        // 'e.target' gives you the element
        e.preventDefault();
        alert('Button Clicked!');
    }
}));
</script>

```

> **Note:** Events receive the native Event Object (`e`). You can access the element via `e.target` or `e.currentTarget`.

### 6. Side Effects (`s-effect`)

Use `s-effect` to run a function automatically whenever its dependencies change.

```html
<div s-data="saveApp" s-effect="autoSave">
    <textarea s-model="note"></textarea>
    <span s-text="status"></span>
</div>

<script>
spiki.data('saveApp', () => ({
    note: localStorage.getItem('note') || '',
    status: '',
    
    autoSave() {
        localStorage.setItem('note', this.note);
        this.status = 'Saved!';
    }
}));
</script>

```

> **Note:** The function receives the element (`el`) as an argument. Useful if you need to update something visual on the container when data changes.

### 7. Form Inputs (`s-model` vs `s-value`)

* **`s-model` (Two-Way):** Updates data when user types, and updates input when data changes.
* **`s-value` (One-Way):** Only updates the input when data changes.

```html
<div s-data="formApp">
    <input type="text" s-model="username">
    
    <input type="text" s-value="previewName" readonly>
</div>

<script>
spiki.data('formApp', () => ({
    username: 'john_doe',
    
    get previewName() {
        return this.username.toUpperCase();
    }
}));
</script>

```

---

## Mastering Lists (`s-for`)

### 1. Basic Loop Requirement

You **MUST** use the `<template>` tag. Spiki uses the template to stamp out copies of your HTML.

```html
<ul>
    <template s-for="user in users" s-key="id">
        <li><span s-text="user.name"></span></li>
    </template>
</ul>

```

### 2. Accessing Data Inside Loop (`this.item`)

When you trigger an event inside a loop, Spiki automatically injects the current item into `this`. The property name matches your loop alias.

```html
<div s-data="shopApp">
    <ul>
        <template s-for="product in products" s-key="id">
            <li>
                <span s-text="product.name"></span>
                <button s-click="selectProduct">Select</button>
            </li>
        </template>
    </ul>
</div>

<script>
spiki.data('shopApp', () => ({
    products: [
        { id: 1, name: 'Laptop' },
        { id: 2, name: 'Phone' }
    ],
    selectProduct() {
        // 'this.product' is automatically available
        console.log('You selected:', this.product.name);
    }
}));
</script>

```

### 3. Accessing Index

You can get the current index by using parentheses: `(item, index) in array`.

```html
<template s-for="(item, i) in list" s-key="id">
    <button s-click="remove">
        Remove Index <span s-text="i"></span>
    </button>
</template>

<script>
spiki.data('listApp', () => ({
    list: ['A', 'B', 'C'],
    remove() {
        // 'this.i' is automatically available
        this.list.splice(this.i, 1);
    }
}));
</script>

```

---

## Advanced Features

### DOM References (`s-ref`)

Sometimes you need to access the raw DOM element (e.g., to focus an input or play a video).

```html
<div s-data="refApp">
    <input s-ref="myInput" type="text">
    <button s-click="focusMe">Focus Input</button>
</div>

<script>
spiki.data('refApp', () => ({
    focusMe() {
        // Access DOM element via this.$refs
        this.$refs.myInput.focus();
    }
}));
</script>

```

---

## Core Concepts

### Component Instance (`this`)

Inside your functions, `this` refers to your component state.

> **Warning:** Do not use arrow functions for methods (`func: () => {}`) if you need `this`. Use method shorthand (`func() {}`) instead.

Spiki injects helper properties:

* **`this.$root`**: The HTML element containing the component.
* **`this.$refs`**: Access elements marked with `s-ref`.
* **`this.$store`**: Access the global store.
* **`this.$parent`**: Access the parent component.

### Global Store

Share state across multiple components.

```javascript
// 1. Define Store
spiki.store('user', {
    name: 'John Doe',
    isLoggedIn: true
});

// 2. Use in Component
spiki.data('profile', () => ({
    get userName() {
        return this.$store.user.name; // Reactive!
    }
}));

```

### `spiki.raw(proxy)`

Get the original object from a Spiki proxy. Useful for console logging or API calls.

```javascript
const cleanData = spiki.raw(this.myData);
console.log(cleanData); 

```

---

## Browser Support

Spiki requires a browser that supports **ES6 Proxy**.

* **Supported:** Chrome, Firefox, Edge, Safari (Modern versions).
* **Not Supported:** Internet Explorer 11.

## License

MIT License.
