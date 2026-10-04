/* =========================================================
   DAFTARI - الادخار يُخصم من المتبقي
   (run with: node tests/savings-remaining.test.js)

   القاعدة: المتبقي = الدخل - المصروفات - الادخار
   الاختبار الإلزامي:
     الدخل 1,000,000 + مصروفات 300,000 -> 700,000
     ادخار 100,000                     -> 600,000
     حذف الادخار                       -> 700,000
     ادخار 200,000                     -> 500,000
========================================================== */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SCRIPT_SOURCE = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
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

/* دخل 1,000,000 ومصروفات 300,000 بلا مصروفات ثابتة */
function seed(income, expense) {
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
                        salary: income,
                        loan: 0,
                        fuelBudget: 0,
                        mobileInternet: 0,
                        homeContribution: 0,
                        norhanContribution: 0,
                        generator: 0,
                        homeInternet: 0,
                        rent: 0
                    },
                    expenses: expense
                        ? [{
                            id: 1,
                            title: "مصروف",
                            amount: expense,
                            date: now.toISOString()
                        }]
                        : [],
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
            monthKey,
            monthFinance,
            savingsReserved,
            savingsStats,
            savingsMonthlyReport,
            addSavingsTransaction,
            getSavingsBalance,
            numberValue,
            currency,
            formatNumber,
            formatMoneyInput,
            renderAll,
            renderExpensesPage,
            saveDatabase,
            commit,
            setMonth: (year, month) => {
                currentYear = year;
                currentMonth = month;
                ensureCurrentMonth();
            }
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

function testMandatoryScenario() {
    console.log("\n1) الاختبار الإلزامي: 1,000,000 / 300,000 / ادخار");

    const app = createApp(seed(1000000, 300000));

    check(
        remainingText(app) === app.currency(700000),
        "قبل الادخار: المتبقي = 700,000"
    );

    /* ادخار 100,000 */
    app.addSavingsTransaction({ type: "deposit", amount: 100000 });

    check(
        remainingText(app) === app.currency(600000),
        "ادخار 100,000: المتبقي = 600,000"
    );

    check(app.savingsReserved() === 100000, "الادخار = 100,000");
    check(app.getSavingsBalance() === 100000, "رصيد الادخار = 100,000");
    check(
        app.getElement("savingValue").textContent === app.formatNumber(100000),
        "بطاقة الادخار تعرض 100,000"
    );

    /* حذف الادخار = سحبه بالكامل */
    app.addSavingsTransaction({ type: "withdraw", amount: 100000 });

    check(
        remainingText(app) === app.currency(700000),
        "بعد حذف الادخار: المتبقي = 700,000 (عاد 100,000)"
    );

    check(app.savingsReserved() === 0, "الادخار = 0 بعد الحذف");

    /* ادخار 200,000 */
    app.addSavingsTransaction({ type: "deposit", amount: 200000 });

    check(
        remainingText(app) === app.currency(500000),
        "ادخار 200,000: المتبقي = 500,000"
    );
}

function testReduce() {
    console.log("\n2) تقليل الادخار من 100,000 إلى 60,000");

    const app = createApp(seed(1000000, 300000));

    app.addSavingsTransaction({ type: "deposit", amount: 100000 });

    check(remainingText(app) === app.currency(600000), "البداية: المتبقي = 600,000");

    app.addSavingsTransaction({ type: "withdraw", amount: 40000 });

    check(app.savingsReserved() === 60000, "الادخار صار 60,000");
    check(
        remainingText(app) === app.currency(640000),
        "المتبقي زاد 40,000 -> 640,000"
    );
}

function testMultipleOperations() {
    console.log("\n3) أكثر من عملية ادخار");

    const app = createApp(seed(1000000, 300000));

    app.addSavingsTransaction({ type: "deposit", amount: 50000 });
    app.addSavingsTransaction({ type: "deposit", amount: 100000 });

    check(app.savingsReserved() === 150000, "إجمالي الادخار = 150,000");
    check(
        remainingText(app) === app.currency(550000),
        "المتبقي = 1,000,000 - 300,000 - 150,000 = 550,000"
    );
}

function testNoDoubleDeduction() {
    console.log("\n4) لا خصم مزدوج عند إعادة التحميل");

    const app = createApp(seed(1000000, 300000));

    app.addSavingsTransaction({ type: "deposit", amount: 100000 });
    app.commit();

    /* إعادة رسم وحفظ متكررة (تحاكي إعادة تحميل الصفحة) */
    app.renderAll();
    app.commit();
    app.renderAll();
    app.commit();

    check(
        remainingText(app) === app.currency(600000),
        "المتبقي ما زال 600,000 بعد إعادة التحميل"
    );

    check(
        app.savingsReserved() === 100000,
        "الادخار ما زال 100,000 (لم يتضاعف)"
    );
}

function testFromExpensesNotDoubled() {
    console.log("\n5) مصروف محوّل للادخار لا يُخصم مرتين");

    const app = createApp(seed(1000000, 300000));

    /* الشكل الحقيقي: مصروف موسوم isSavings + حركة مرتبطة به */
    app.currentMonthData().expenses.push({
        id: 500,
        title: "ادخار",
        amount: 50000,
        isSavings: true,
        transactionId: 500,
        date: new Date().toISOString()
    });

    app.addSavingsTransaction({
        type: "fromExpenses",
        amount: 50000,
        transactionId: 500
    });

    check(
        app.savingsReserved() === 50000,
        "المبلغ محسوب مرة واحدة عبر الادخار"
    );

    check(
        remainingText(app) === app.currency(650000),
        "المتبقي = 1,000,000 - 300,000 - 50,000 = 650,000 (خصم واحد فقط)"
    );

    check(
        remainingText(app) !== app.currency(600000),
        "ليس 600,000 - أي لا خصم مزدوج"
    );
}

function testMonthIsolation() {
    console.log("\n6) نظام الأشهر: ادخار شهر آخر لا يخصم من هذا الشهر");

    const app = createApp(seed(1000000, 300000));

    const now = new Date();
    const otherDate = new Date(
        now.getFullYear(),
        now.getMonth() === 0 ? 1 : 0,
        15,
        12
    ).toISOString();

    app.addSavingsTransaction({
        type: "deposit",
        amount: 100000,
        date: otherDate
    });

    check(
        remainingText(app) === app.currency(700000),
        "ادخار شهر آخر لا يخصم من المتبقي الحالي"
    );

    check(
        app.getSavingsBalance() === 100000,
        "رصيد الادخار التراكمي = 100,000"
    );

    app.addSavingsTransaction({ type: "deposit", amount: 50000 });

    check(
        remainingText(app) === app.currency(650000),
        "ادخار الشهر الحالي (50,000) يخصم فقط"
    );
}

function testFormatAndStorage() {
    console.log("\n7) الفواصل أثناء الإدخال + التخزين رقم");

    const app = createApp(seed(1000000, 300000));

    const input = { value: "", selectionStart: 0 };

    "100000".split("").forEach((digit) => {
        input.value =
            input.value.slice(0, input.selectionStart) +
            digit +
            input.value.slice(input.selectionStart);

        input.selectionStart += 1;

        app.formatMoneyInput(input);
    });

    check(input.value === "100,000", "100000 تظهر 100,000 أثناء الإدخال");
    check(
        app.numberValue(input.value) === 100000,
        "الحساب يستخدم 100000 بدون فواصل"
    );

    app.addSavingsTransaction({
        type: "deposit",
        amount: app.numberValue(input.value)
    });

    app.saveDatabase();

    const raw = app.raw();

    check(raw.indexOf('"amount":100000') !== -1, "التخزين يحوي 100000 كرقم");
    check(raw.indexOf("100,000") === -1, "لا نص بالفواصل داخل التخزين");
}

function testPersistence() {
    console.log("\n8) الحفظ + Firestore + بلا أخطاء");

    const app = createApp(seed(1000000, 300000));

    app.addSavingsTransaction({ type: "deposit", amount: 100000 });
    app.commit();

    const saved = JSON.parse(app.raw());

    check(
        saved.savingsLedger.transactions.length === 1,
        "عملية الادخار محفوظة داخل savingsLedger (نفس حقل Firestore)"
    );

    check(saved.savingsLedger.transactions[0].type === "deposit", "النوع deposit");
    check(
        saved.savingsLedger.transactions[0].amount === 100000,
        "المبلغ 100000 محفوظ رقماً"
    );

    let error = null;

    try {
        app.renderAll();
        app.commit();
        app.renderAll();
        app.commit();
        app.renderAll();
    } catch (e) {
        error = e;
    }

    check(error === null, "لا أخطاء JavaScript أثناء العرض والحفظ");
    check(
        remainingText(app) === app.currency(600000),
        "المتبقي 600,000 بعد كل العمليات"
    );
}

console.log("DAFTARI - الادخار والمتبقي");

try {
    testMandatoryScenario();

    testReduce();

    testMultipleOperations();

    testNoDoubleDeduction();

    testFromExpensesNotDoubled();

    testMonthIsolation();

    testFormatAndStorage();

    testPersistence();
} catch (error) {
    failed += 1;

    console.error("\nUnexpected error:");
    console.error(error);
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);