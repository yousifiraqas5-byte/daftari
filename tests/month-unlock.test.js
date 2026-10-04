/* =========================================================
   DAFTARI - فتح قفل الشهر السابق (المرحلة الثالثة)
   (run with: node tests/month-unlock.test.js)

     1) زر الفتح موجود مرة واحدة في الأعلى فقط
     2) الشهر السابق مغلق افتراضياً مع 🔒
     3) الفتح يجعله قابلاً للتعديل وينتقل إليه
     4) لا يمكن فتح شهر أقدم (لا تخطّي)
     5) الفتح لا يغيّر أي بيانات
     6) بعد الفتح التعديل يعمل طبيعياً
========================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SCRIPT_SOURCE = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
const HTML_SOURCE = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const STORAGE_KEY = "daftari_v2";

let passed = 0;
let failed = 0;

function check(condition, label) {
    if (condition) {
        passed += 1;
        console.log(`  ok   ${label}`);
    } else {
        failed += 1;
        console.log(`  FAIL ${label}`);
    }
}

function createElement(tag = "div", registry = null) {
    const classes = new Set();
    const listeners = {};
    const attributes = {};
    let html = "";

    const element = {
        tagName: String(tag).toUpperCase(),
        id: "",
        textContent: "",
        value: "",
        children: [],
        dataset: {},
        style: {},
        attributes,

        classList: {
            add: (...n) => n.forEach((x) => classes.add(x)),
            remove: (...n) => n.forEach((x) => classes.delete(x)),
            contains: (n) => classes.has(n),
            toggle: (n, force) => {
                const add = force === undefined ? !classes.has(n) : Boolean(force);
                if (add) { classes.add(n); } else { classes.delete(n); }
                return add;
            }
        },

        addEventListener(type, handler) {
            (listeners[type] = listeners[type] || []).push(handler);
        },

        removeEventListener() {},

        dispatch(type, event) {
            (listeners[type] || []).forEach((handler) => handler(
                event || { type, target: element, preventDefault() {} }
            ));
        },

        setAttribute(name, value) { attributes[name] = String(value); },

        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attributes, name)
                ? attributes[name]
                : null;
        },

        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        appendChild(child) { element.children.push(child); return child; },
        remove() {},
        focus() {},
        contains: () => false
    };

    Object.defineProperty(element, "innerHTML", {
        get() { return html; },
        set(value) {
            if (registry) {
                (html.match(/id="[^"]+"/g) || [])
                    .forEach((token) => registry.delete(token.slice(4, -1)));
            }

            html = String(value);
        }
    });

    return element;
}

function createDocument() {
    const elements = new Map();

    const document = {
        body: createElement("body", elements),
        documentElement: createElement("html", elements),

        getElementById(id) {
            if (!elements.has(id)) {
                const element = createElement("div", elements);
                element.id = id;
                elements.set(id, element);
            }

            return elements.get(id);
        },

        querySelector: () => null,
        querySelectorAll: () => [],
        createElement,
        addEventListener() {},
        removeEventListener() {}
    };

    document.elements = elements;

    return document;
}

/* مفتاح الشهر قبل/بعد شهر معيّن */
function shiftKey(key, delta) {
    const parts = key.split("-");
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function keyParts(key) {
    const parts = key.split("-");

    return { year: Number(parts[0]), month: Number(parts[1]) - 1 };
}

/* بيانات الشهر الحالي + شهر سابق فيه مصروفات */
function seed(previousMonth) {
    const today = new Date();
    const thisKey =
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    const previousKey = shiftKey(thisKey, -1);
    const prev = keyParts(previousKey);

    const months = {};

    months[thisKey] = {
        year: today.getFullYear(),
        month: today.getMonth(),
        settings: {},
        expenses: [],
        carExpenses: [],
        homeExpenses: [],
        tasks: []
    };

    if (previousMonth) {
        months[previousKey] = {
            year: prev.year,
            month: prev.month,
            settings: { salary: 1000000 },
            expenses: [{
                id: 77,
                title: "مصروف الشهر السابق",
                amount: 250000,
                date: new Date(prev.year, prev.month, 5, 12).toISOString()
            }],
            carExpenses: [],
            homeExpenses: [],
            tasks: []
        };
    }

    return {
        [STORAGE_KEY]: JSON.stringify({
            months,
            savingsLedger: { transactions: [], debtors: [], walletTransactions: [] }
        })
    };
}

function createApp(storageSeed) {
    const store = new Map(
        Object.entries(storageSeed).map(([key, value]) => [key, String(value)])
    );

    const document = createDocument();

    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        JSON,
        Math,
        Date,
        document,
        window: {
            scrollTo() {},
            addEventListener() {},
            location: { origin: "https://daftari.test" }
        },
        navigator: { onLine: true },
        localStorage: {
            getItem: (key) => (store.has(key) ? store.get(key) : null),
            setItem: (key, value) => { store.set(key, String(value)); },
            removeItem: (key) => { store.delete(key); }
        }
    };

    sandbox.window.document = document;

    vm.createContext(sandbox);
    vm.runInContext(SCRIPT_SOURCE, sandbox, { filename: "script.js" });

    vm.runInContext(
        `
        globalThis.__daftari = {
            getDatabase: () => database,
            currentMonthData,
            ensureCurrentMonth,
            monthKey,
            monthNameOf: (key) => key,
            previousMonthKey,
            isMonthUnlocked,
            isMonthClosed,
            getUnlockedMonths,
            unlockPreviousMonth,
            updatePreviousMonthUnlock,
            updateMonthHeader,
            deleteRecord,
            saveDatabase,
            setView: (year, month) => {
                currentYear = year;
                currentMonth = month;
                ensureCurrentMonth();
                updateMonthHeader();
            },
            view: () => ({ year: currentYear, month: currentMonth })
        };
        `,
        sandbox,
        { filename: "expose.js" }
    );

    return Object.assign(
        {
            sandbox,
            store,
            getElement: (id) => document.getElementById(id),
            raw: () => (store.has(STORAGE_KEY) ? store.get(STORAGE_KEY) : null)
        },
        sandbox.__daftari
    );
}

function testButtonLocation() {
    console.log("\n1) زر الفتح في الأعلى مرة واحدة فقط");

    const count =
        (HTML_SOURCE.match(/id="unlockPreviousMonthButton"/g) || []).length;

    check(count === 1, "زر الفتح موجود مرة واحدة فقط في التطبيق");

    check(
        HTML_SOURCE.indexOf('id="previousMonthUnlockText"') !== -1,
        "نص حالة الشهر السابق موجود"
    );

    const buttonAt = HTML_SOURCE.indexOf('id="unlockPreviousMonthButton"');
    const mainAt = HTML_SOURCE.indexOf('<main class="main-content">');
    const monthBarAt = HTML_SOURCE.indexOf('class="month-bar"');

    check(
        mainAt !== -1 && buttonAt > monthBarAt && buttonAt < mainAt,
        "الزر في الأعلى بجانب شريط الشهر (قبل المحتوى)"
    );

    const sectionsBefore =
        (HTML_SOURCE.slice(0, buttonAt).match(/<section/g) || []).length;

    check(
        sectionsBefore === 0,
        "الزر ليس داخل أي قسم (لا تكرار داخل الأقسام)"
    );
}

function testDefaultLocked() {
    console.log("\n2) الشهر السابق مغلق افتراضياً");

    const app = createApp(seed());
    const prev = keyParts(app.previousMonthKey());

    app.updatePreviousMonthUnlock();

    check(app.isMonthUnlocked(prev.year, prev.month) === false, "غير مفتوح بعد");
    check(app.isMonthClosed(prev.year, prev.month) === true, "مغلق افتراضياً");

    const text = app.getElement("previousMonthUnlockText").textContent;

    check(text.indexOf("🔒") !== -1, "تظهر علامة 🔒 في أعلى التطبيق");

    check(
        app.getElement("unlockPreviousMonthButton").classList.contains("hidden") === false,
        "زر الفتح ظاهر"
    );
}

function testUnlockWorks() {
    console.log("\n3) الفتح يجعل الشهر السابق قابلاً للتعديل وينتقل إليه");

    const app = createApp(seed());
    const key = app.previousMonthKey();
    const prev = keyParts(key);

    app.unlockPreviousMonth();

    check(app.isMonthUnlocked(prev.year, prev.month) === true, "الشهر السابق مفتوح");
    check(app.isMonthClosed(prev.year, prev.month) === false, "لم يعد مغلقاً");

    const view = app.view();

    check(
        view.year === prev.year && view.month === prev.month,
        "التنقل انتقل إلى الشهر السابق"
    );

    check(
        app.getDatabase().unlockedMonths.indexOf(key) !== -1,
        "حالة الفتح محفوظة"
    );

    app.updatePreviousMonthUnlock();

    check(
        app.getElement("previousMonthUnlockText").textContent.indexOf("🔓") !== -1,
        "تظهر حالة مفتوح"
    );

    check(
        app.getElement("unlockPreviousMonthButton").classList.contains("hidden"),
        "زر الفتح اختفى (لا يُنشئ قفلاً جديداً)"
    );

    app.unlockPreviousMonth();

    check(
        app.getDatabase().unlockedMonths.filter((k) => k === key).length === 1,
        "الفتح مرتين لا يكرر السجل"
    );
}

function testNoSkipping() {
    console.log("\n4) لا يمكن فتح شهر أقدم من الشهر السابق");

    const app = createApp(seed());
    const key = app.previousMonthKey();

    const olderKey = shiftKey(key, -1);
    const older = keyParts(olderKey);
    const future = keyParts(shiftKey(key, 1));

    /* حتى لو قُفلت يدوياً في التخزين */
    app.getDatabase().unlockedMonths = [olderKey, shiftKey(key, 1)];

    check(
        app.isMonthUnlocked(older.year, older.month) === false,
        "الشهر الأقدم لا يُفتح حتى لو وُضع في التخزين"
    );

    check(
        app.isMonthClosed(older.year, older.month) === true,
        "الشهر الأقدم يبقى مقفلاً"
    );

    check(
        app.isMonthUnlocked(future.year, future.month) === false,
        "لا يوجد قفل لشهر غير سابق"
    );

    app.unlockPreviousMonth();

    check(
        app.isMonthUnlocked(older.year, older.month) === false,
        "فتح سبتمبر لا يفتح أغسطس"
    );

    check(
        app.isMonthClosed(older.year, older.month) === true,
        "أغسطس يبقى مقفلاً بعد فتح سبتمبر"
    );

    const now = new Date();

    check(
        app.isMonthClosed(now.getFullYear(), now.getMonth()) === false,
        "الشهر الحالي مفتوح دائماً"
    );
}

function testDataPreserved() {
    console.log("\n5) الفتح لا يغيّر أي بيانات");

    const app = createApp(seed(true));
    const key = app.previousMonthKey();
    const prev = keyParts(key);

    const month = app.getDatabase().months[key];

    /* نسخ بيانات المستخدم فقط (الإعدادات يُرقّعها التطبيق تلقائياً) */
    const expensesBefore = JSON.stringify(month.expenses);
    const carBefore = JSON.stringify(month.carExpenses);
    const homeBefore = JSON.stringify(month.homeExpenses);
    const tasksBefore = JSON.stringify(month.tasks);

    app.unlockPreviousMonth();

    const after = app.getDatabase().months[key];

    check(
        JSON.stringify(after.expenses) === expensesBefore &&
            JSON.stringify(after.carExpenses) === carBefore &&
            JSON.stringify(after.homeExpenses) === homeBefore &&
            JSON.stringify(after.tasks) === tasksBefore,
        "بيانات الشهر السابق لم تتغير إطلاقاً"
    );

    check(
        app.currentMonthData().expenses.length === 1 &&
            app.currentMonthData().expenses[0].amount === 250000,
        "مصروف الشهر السابق موجود كما هو"
    );

    check(
        app.currentMonthData().settings.salary === 1000000,
        "إعدادات الشهر السابق كما هي"
    );
}

function testEditingAfterUnlock() {
    console.log("\n6) بعد الفتح التعديل يعمل طبيعياً");

    const app = createApp(seed(true));

    const key = app.previousMonthKey();
    const prev = keyParts(key);

    check(
        app.isMonthClosed(prev.year, prev.month) === true,
        "قبل الفتح: الشهر مغلق"
    );

    /* الانتقال للشهر السابق وهو ما زال مقفلاً */
    app.setView(prev.year, prev.month);

    check(app.isMonthClosed() === true, "بعد التنقل: الشهر السابق مقفل");

    app.deleteRecord("expenses", 77);

    check(
        app.currentMonthData().expenses.length === 1,
        `len=${app.currentMonthData().expenses.length} (الحذف مرفوض والمصروف باقٍ)`
    );

    check(
        app.getElement("monthLock").classList.contains("hidden") === false,
        "شارة 🔒 شهر مغلق ظاهرة بجانب اسم الشهر"
    );

    app.unlockPreviousMonth();

    check(app.isMonthClosed() === false, "بعد الفتح: الشهر مفتوح");

    app.currentMonthData().expenses.push({
        id: 900,
        title: "مصروف جديد",
        amount: 10000,
        date: new Date().toISOString()
    });

    app.deleteRecord("expenses", 900);

    check(
        app.currentMonthData().expenses.length === 1,
        "بعد الفتح: الحذف والإضافة يعملان مباشرة بلا ضغط مطول"
    );

    app.saveDatabase();

    check(
        JSON.parse(app.raw()).months[key].expenses[0].amount === 250000,
        "بيانات الشهر السابق سليمة بعد التعديل"
    );

    const reloaded = createApp({ [STORAGE_KEY]: app.raw() });

    check(
        reloaded.isMonthUnlocked(prev.year, prev.month) === true,
        "حالة الفتح تبقى بعد إعادة التحميل"
    );
}

console.log("DAFTARI - فتح قفل الشهر السابق");

try {
    testButtonLocation();

    testDefaultLocked();

    testUnlockWorks();

    testNoSkipping();

    testDataPreserved();

    testEditingAfterUnlock();
} catch (error) {
    failed += 1;

    console.error("\nUnexpected error:");
    console.error(error);
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);