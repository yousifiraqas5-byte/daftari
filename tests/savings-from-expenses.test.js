/* =========================================================
   DAFTARI - الادخار من المصروفات الشخصية (المرحلة الرابعة)
   (run with: node tests/savings-from-expenses.test.js)

   إصلاح: اختيار «ادخار» في المصروفات الشخصية كان يظهر رسالة نجاح
   فقط. الآن العملية تُحفظ مربوطة في السجلين بمعرّف واحد:

     المصروفات الشخصية  ↔  الادخار  ↔  سجل الحركات
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

/*
    دخل 1,000,000 + مصروف عادي 300,000 + ادخار سابق 500,000
    => المتبقي قبل = 200,000
*/
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
                        title: "مصروف عادي",
                        amount: 300000,
                        date: now.toISOString()
                    }],
                    carExpenses: [],
                    homeExpenses: [],
                    tasks: []
                }
            },
            savingsLedger: {
                transactions: [{
                    id: 10,
                    type: "deposit",
                    amount: 500000,
                    note: "",
                    date: now.toISOString()
                }],
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
            openPersonalExpenseModal,
            addSavingsTransaction,
            getSavingsLedger,
            getSavingsBalance,
            savingsReserved,
            spentExpensesTotal,
            deleteRecord,
            renderExpensesPage,
            renderSavingsPage,
            renderSavingsLog,
            renderAll,
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

function expensesHtml(app) {
    app.renderExpensesPage();

    return app.getElement("customExpenseList").innerHTML;
}

function logHtml(app) {
    app.renderSavingsLog();

    return app.getElement("savingsLogList").innerHTML;
}

/* يملأ نموذج المصروف الشخصي ويحفظه */
function addExpense(app, amount, isSavings, title) {
    app.openPersonalExpenseModal();

    app.getElement("genericAmount").value = amount;
    app.getElement("genericTitle").value = title || "";
    app.getElement("genericIsSavings").checked = Boolean(isSavings);

    app.getElement("genericForm").dispatch("submit", { preventDefault() {} });
}

function testSavesInBothPlaces() {
    console.log("\n1) ادخار 200,000 من المصروفات الشخصية");

    const app = createApp(seed());

    check(app.getSavingsBalance() === 500000, "إجمالي الادخار قبل = 500,000");
    check(remainingText(app) === app.currency(200000), "المتبقي قبل = 200,000");

    addExpense(app, "200,000", true);

    const expenses = app.currentMonthData().expenses;
    const record = expenses[expenses.length - 1];

    /* 1) يظهر في المصروفات الشخصية */
    const listHtml = expensesHtml(app);

    check(listHtml.indexOf("200,000") !== -1, "العملية ظاهرة في المصروفات الشخصية");
    check(
        listHtml.indexOf("ادخار من المصروفات الشخصية") !== -1,
        "موسومة بأنها ادخار من المصروفات الشخصية"
    );
    check(record.isSavings === true, "السجل موسوم isSavings");
    check(record.amount === 200000, "المبلغ 200,000 محفوظ رقماً");

    /* 2) إجمالي الادخار */
    check(
        app.getSavingsBalance() === 700000,
        "إجمالي الادخار صار 700,000 (500,000 + 200,000)"
    );

    check(
        app.getElement("savingsBalance").textContent === app.currency(700000),
        "قسم الادخار يعرض 700,000"
    );

    /* 3) سجل الحركات */
    const movements = app.getSavingsLedger().transactions;
    const movement = movements[movements.length - 1];
    const html = logHtml(app);

    check(movements.length === 2, "حركة جديدة في سجل الحركات");
    check(movement.type === "deposit", "نوع الحركة: إيداع ادخار");
    check(movement.amount === 200000, "مبلغ الحركة 200,000");
    check(movement.source === "personalExpenses", "مصدر العملية: المصروفات الشخصية");
    check(html.indexOf("إيداع ادخار") !== -1, "السجل يعرض «إيداع ادخار»");
    check(html.indexOf("المصروفات الشخصية") !== -1, "السجل يعرض المصدر");
    check(
        /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(html),
        "التاريخ والوقت في السجل"
    );

    /* 4) معرف واحد يربط السجلين - ولا تكرار */
    check(
        record.transactionId === movement.transactionId,
        "معرّف واحد يربط المصروف بالحركة"
    );

    check(
        movements.filter((m) => m.transactionId === record.transactionId).length === 1,
        "حركة واحدة فقط لكل عملية (لا تكرار)"
    );

    /* 5) المتبقي - خصم واحد فقط */
    check(remainingText(app) === app.currency(0), "المتبقي = 0 بعد خصم 200,000");
    check(
        remainingText(app) !== app.currency(-200000),
        "ليس -200,000 - أي لا خصم مزدوج"
    );

    check(
        app.spentExpensesTotal(app.currentMonthData()) === 300000,
        "المصروف المحسوب ما زال 300,000 (الادخار لا يُحسب مصروفاً)"
    );

    check(
        app.getElement("toast").textContent ===
            "تم حفظ الادخار وإضافته لسجل الحركات",
        "رسالة نجاح بعد الحفظ الفعلي"
    );
}

function testPersisted() {
    console.log("\n2) الحفظ والمزامنة في السجلين");

    const app = createApp(seed());

    addExpense(app, "200,000", true);

    const saved = JSON.parse(app.raw());
    const monthExpenses = saved.months[
        Object.keys(saved.months)[0]
    ].expenses;

    const savedRecord = monthExpenses[monthExpenses.length - 1];

    check(
        savedRecord.isSavings === true && savedRecord.amount === 200000,
        "المصروف محفوظ في month.expenses"
    );

    check(
        typeof savedRecord.transactionId === "number",
        "معرّف الربط محفوظ"
    );

    check(
        saved.savingsLedger.transactions.length === 2 &&
            saved.savingsLedger.transactions[1].source === "personalExpenses" &&
            saved.savingsLedger.transactions[1].transactionId ===
                savedRecord.transactionId,
        "الحركة محفوظة في نفس حقل Firestore ومربوطة بالمصروف"
    );

    check(
        saved.savingsLedger.transactions[1].amount === 200000,
        "المبلغ محفوظ رقماً في سجل الحركات"
    );
}

function testDeleteKeepsBothInSync() {
    console.log("\n3) حذف العملية يزيلها من السجلين");

    const app = createApp(seed());

    addExpense(app, "200,000", true);

    const record = app.currentMonthData().expenses.slice(-1)[0];

    app.deleteRecord("expenses", record.id);

    check(
        app.currentMonthData().expenses.length === 1,
        "المصروف حُذف من المصروفات الشخصية"
    );

    check(
        app.getSavingsLedger().transactions.length === 1,
        "الحركة المرتبطة حُذفت من سجل الادخار (لا حركة يتيمة)"
    );

    check(
        app.getSavingsBalance() === 500000,
        "إجمالي الادخار عاد 500,000"
    );

    check(
        remainingText(app) === app.currency(200000),
        "المتبقي عاد 200,000"
    );
}

function testPlainExpenseUnaffected() {
    console.log("\n4) مصروف عادي (بدون ادخار) لا يتأثر");

    const app = createApp(seed());

    addExpense(app, "50,000", false, "مvu");

    check(
        app.getSavingsBalance() === 500000,
        "إجمالي الادخار لم يتغير"
    );

    check(
        app.getSavingsLedger().transactions.length === 1,
        "لا حركة ادخار جديدة"
    );

    check(
        app.spentExpensesTotal(app.currentMonthData()) === 350000,
        "المصروفات المحسوبة = 300,000 + 50,000"
    );

    check(
        remainingText(app) === app.currency(150000),
        "المتبقي = 1,000,000 - 350,000 - 500,000 = 150,000"
    );

    check(
        app.currentMonthData().expenses.slice(-1)[0].transactionId === null,
        "المصروف العادي بلا معرف ربط"
    );
}

console.log("DAFTARI - الادخار من المصروفات الشخصية");

try {
    testSavesInBothPlaces();

    testPersisted();

    testDeleteKeepsBothInSync();

    testPlainExpenseUnaffected();
} catch (error) {
    failed += 1;

    console.error("\nUnexpected error:");
    console.error(error);
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);