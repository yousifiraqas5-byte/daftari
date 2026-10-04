/* =========================================================
   DAFTARI - تعديل الادخار من بطاقة المصروفات الأساسية
   (run with: node tests/savings-basic-edit.test.js)

   الاستقطاع محسوب مرة واحدة، والتعديل يسجّل الفرق فقط:
     0 -> 100,000   إيداع 100,000
     100,000 -> 60,000  سحب 40,000  (ولا يصبح 160,000)
     60,000 -> 0    سحب 60,000
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
        checked: false,
        disabled: false,
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

/* دخل 1,000,000 + مصروف 300,000، بلا ادخار */
function seed() {
    const now = new Date();
    const key =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    return {
        [STORAGE_KEY]: JSON.stringify({
            months: {
                [key]: {
                    year: now.getFullYear(),
                    month: now.getMonth(),
                    settings: {
                        salary: 1000000,
                        loan: 0,
                        fuelBudget: 0,
                        mobileInternet: 0,
                        homeContribution: 0,
                        norhanContribution: 0,
                        generator: 0,
                        homeInternet: 0,
                        rent: 0
                    },
                    expenses: [{
                        id: 1,
                        title: "مصروف",
                        amount: 300000,
                        date: now.toISOString()
                    }],
                    carExpenses: [],
                    homeExpenses: [],
                    tasks: []
                }
            },
            savingsLedger: {
                transactions: [],
                debtors: [],
                walletTransactions: []
            }
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
            currentMonthData,
            openSavingModal,
            savingsReserved,
            getSavingsLedger,
            getSavingsBalance,
            migrateSavingsLedger,
            renderExpensesPage,
            renderSavingsLog,
            deleteSavingsMovement,
            commit,
            currency,
            formatNumber
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

function remainingText(app) {
    app.renderExpensesPage();

    return app.getElement("monthRemaining").textContent;
}

/* يفتح نافذة تعديل الادخار ويحفظ قيمة */
function setSavings(app, value) {
    app.openSavingModal();

    app.getElement("genericAmount").value = value;
    app.getElement("genericForm").dispatch("submit", { preventDefault() {} });
}

function movements(app) {
    return app.getSavingsLedger().transactions;
}

function testCardIsEditable() {
    console.log("\n1) بطاقة الادخار قابلة للتعديل");

    check(
        HTML_SOURCE.indexOf('id="setSavingButton"') !== -1,
        "زر التعديل موجود"
    );

    const app = createApp(seed());

    check(app.savingsReserved() === 0, "لا استقطاع في البداية");
    check(remainingText(app) === app.currency(700000), "المتبقي = 700,000");

    app.renderExpensesPage();

    check(
        app.getElement("savingValue").textContent === "غير محدد",
        "البطاقة تعرض «غير محدد» بلا ادخار"
    );

    app.openSavingModal();

    check(
        app.getElement("modalContent").innerHTML.indexOf("تعديل الادخار") !== -1,
        "النافذة بعنوان تعديل الادخار"
    );

    check(
        app.getElement("genericAmount").value === "",
        "الحقل يبدأ بلا قيمة (الادخار صفر)"
    );
}

function testSetAndEdit() {
    console.log("\n2) تعيين ثم تعديل ثم إلغاء الاستقطاع");

    const app = createApp(seed());

    setSavings(app, "100,000");

    check(app.savingsReserved() === 100000, "الاستقطاع = 100,000");
    check(movements(app).length === 1, "حركة واحدة فقط");
    check(movements(app)[0].type === "deposit", "النوع: إيداع");
    check(movements(app)[0].amount === 100000, "مبلغ الحركة 100,000");
    check(
        movements(app)[0].source === "basicExpensesCard",
        "المصدر: بطاقة المصروفات الأساسية"
    );
    check(
        remainingText(app) === app.currency(600000),
        "المتبقي = 600,000 (خصم واحد)"
    );

    app.renderExpensesPage();

    check(
        app.getElement("savingValue").textContent === app.formatNumber(100000),
        "البطاقة تعرض 100,000"
    );

    setSavings(app, "60,000");

    check(
        app.savingsReserved() === 60000,
        "الاستقطاع صار 60,000 (ليس 160,000)"
    );

    check(movements(app).length === 2, "حركة جديدة واحدة");
    check(movements(app)[1].type === "withdraw", "النوع: سحب");
    check(
        movements(app)[1].amount === 40000,
        "مبلغ الحركة = الفرق 40,000 فقط"
    );

    check(
        remainingText(app) === app.currency(640000),
        "المتبقي رجع 40,000 إلى 640,000"
    );

    setSavings(app, "0");

    check(app.savingsReserved() === 0, "الاستقطاع = 0");
    check(movements(app).length === 3, "حركة إلغاء");
    check(movements(app)[2].amount === 60000, "سحب 60,000 كاملاً");
    check(
        remainingText(app) === app.currency(700000),
        "المتبقي عاد 700,000"
    );

    check(app.getSavingsBalance() === 0, "رصيد الادخار التراكمي = 0");
}

function testNoDoubleAndNoLegacyField() {
    console.log("\n3) خصم مرة واحدة + لا حركة مكررة بعد التحميل");

    const app = createApp(seed());

    setSavings(app, "100,000");

    check(
        app.currentMonthData().savings === null,
        "الحقل القديم month.savings يبقى فارغاً"
    );

    const saved = JSON.parse(app.raw());
    const monthKey = Object.keys(saved.months)[0];

    check(
        saved.months[monthKey].savings === null ||
            saved.months[monthKey].savings === undefined,
        "لا قيمة في month.savings بعد الحفظ"
    );

    const reloaded = createApp({ [STORAGE_KEY]: app.raw() });

    reloaded.migrateSavingsLedger();
    reloaded.migrateSavingsLedger();

    check(
        movements(reloaded).length === 1,
        "الحركة واحدة بعد الترحيل مرتين (لا تكرار)"
    );

    check(
        reloaded.savingsReserved() === 100000,
        "الاستقطاع ما زال 100,000 بعد إعادة التحميل"
    );

    check(
        remainingText(reloaded) === app.currency(600000),
        "المتبقي ما زال 600,000 (خصم واحد)"
    );

    const before = movements(reloaded).length;

    setSavings(reloaded, "100,000");

    check(
        movements(reloaded).length === before,
        "إعادة نفس القيمة لا تنشئ حركة"
    );
}

function testMovementDeletable() {
    console.log("\n4) حركة التعديل قابلة للحذف من السجل");

    const app = createApp(seed());

    setSavings(app, "100,000");

    app.deleteSavingsMovement(movements(app)[0].id);
    app.getElement("confirmAcceptButton").dispatch("click");

    check(app.savingsReserved() === 0, "حُذف الاستقطاع بعد الحذف");
    check(
        remainingText(app) === app.currency(700000),
        "المتبقي عاد 700,000"
    );
}

console.log("DAFTARI - تعديل الادخار من المصروفات الأساسية");

try {
    testCardIsEditable();

    testSetAndEdit();

    testNoDoubleAndNoLegacyField();

    testMovementDeletable();
} catch (error) {
    failed += 1;

    console.error("\nUnexpected error:");
    console.error(error);
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);