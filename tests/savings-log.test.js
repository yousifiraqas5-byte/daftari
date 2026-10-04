/* =========================================================
   DAFTARI - سجل حركات الادخار (حفظ + حذف)
   (run with: node tests/savings-log.test.js)

     1) كل إيداع يُسجَّل حركة مستقلة في السجل
     2) الحركة تعرض النوع والمبلغ والتاريخ والوقت
     3) الترتيب من الأحدث إلى الأقدم
     4) زر الحذف موجود beside كل حركة
     5) التأكيد قبل الحذف، والإلغاء لا يحذف
     6) بعد الحذف: يتحدّث الإجمالي والمتبقي والواجهة فوراً
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

/* دخل 1,000,000 ومصروفات 300,000 */
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

/* تاريخ ضمن الشهر الحالي بساعة محددة */
function dayISO(day, hour) {
    const now = new Date();

    return new Date(
        now.getFullYear(),
        now.getMonth(),
        day,
        hour,
        30,
        0
    ).toISOString();
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
            addSavingsTransaction,
            deleteSavingsMovement,
            getSavingsLedger,
            getSavingsBalance,
            savingsReserved,
            renderSavingsPage,
            renderSavingsLog,
            renderExpensesPage,
            sortSavingsMovementsDesc,
            SAVINGS_MOVEMENT_LABELS,
            currency,
            formatNumber,
            commit,
            saveDatabase
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

function logHtml(app) {
    app.renderSavingsLog();

    return app.getElement("savingsLogList").innerHTML;
}

function remainingText(app) {
    app.renderExpensesPage();

    return app.getElement("monthRemaining").textContent;
}

function testMovementIsRecorded() {
    console.log("\n1) كل إيداع يُسجَّل حركة مستقلة");

    const app = createApp(seed());

    app.addSavingsTransaction({ type: "deposit", amount: 100000 });

    check(
        app.getSavingsLedger().transactions.length === 1,
        "عملية واحدة = حركة واحدة في السجل"
    );

    const html = logHtml(app);

    check(html.indexOf("إيداع ادخار") !== -1, "نوع الحركة: إيداع ادخار");
    check(html.indexOf("100,000") !== -1, "المبلغ 100,000");
    check(
        /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(html),
        "التاريخ والوقت معروضان"
    );
    check(
        html.indexOf("data-savings-delete=") !== -1,
        "زر الحذف بجانب الحركة"
    );
    check(html.indexOf("🗑️") !== -1, "أيقونة الحذف 🗑️");
}

function testNewestFirst() {
    console.log("\n2) الترتيب من الأحدث إلى الأقدم + الإجمالي 350,000");

    const app = createApp(seed());

    app.addSavingsTransaction({
        type: "deposit", amount: 100000, date: dayISO(1, 10)
    });

    app.addSavingsTransaction({
        type: "deposit", amount: 200000, date: dayISO(2, 11)
    });

    app.addSavingsTransaction({
        type: "deposit", amount: 50000, date: dayISO(3, 12)
    });

    const html = logHtml(app);

    const i50 = html.indexOf("50,000");
    const i200 = html.indexOf("200,000");
    const i100 = html.indexOf("100,000");

    check(
        i50 !== -1 && i200 !== -1 && i100 !== -1,
        "الحركات الثلاث ظاهرة"
    );

    check(
        i50 < i200 && i200 < i100,
        "الترتيب: 50,000 ثم 200,000 ثم 100,000"
    );

    check(app.getSavingsBalance() === 350000, "إجمالي الادخار = 350,000");
    check(app.savingsReserved() === 350000, "الادخار المخصوم = 350,000");
    check(
        remainingText(app) === app.currency(350000),
        "المتبقي = 1,000,000 - 300,000 - 350,000 = 350,000"
    );
}

function testDeleteWithConfirm() {
    console.log("\n3) التأكيد ثم الحذف (مثال 100,000 + 200,000 + 50,000)");

    const app = createApp(seed());

    [
        [100000, dayISO(1, 10)],
        [200000, dayISO(2, 11)],
        [50000, dayISO(3, 12)]
    ].forEach(([amount, date]) => {
        app.addSavingsTransaction({ type: "deposit", amount, date });
    });

    const target = app.getSavingsLedger().transactions.find(
        (item) => item.amount === 200000
    );

    /* زر الحذف */
    app.deleteSavingsMovement(target.id);

    const modalHtml = app.getElement("modalContent").innerHTML;

    check(
        modalHtml.indexOf("حذف حركة الادخار؟") !== -1,
        "رسالة التأكيد ظهرت قبل الحذف"
    );

    check(
        app.getSavingsLedger().transactions.length === 3,
        "لم يُحذف شيء قبل التأكيد"
    );

    /* الإلغاء لا يحذف */
    app.getElement("confirmCancelButton").dispatch("click");

    check(
        app.getSavingsLedger().transactions.length === 3,
        "الإلغاء: الحركات الثلاث باقية"
    );

    check(app.getSavingsBalance() === 350000, "الإلغاء: الإجمالي ما زال 350,000");

    /* التأكيد يحذف */
    app.deleteSavingsMovement(target.id);
    app.getElement("confirmAcceptButton").dispatch("click");

    check(
        app.getSavingsLedger().transactions.length === 2,
        "بعد التأكيد: حُذفت حركة 200,000"
    );

    check(app.getSavingsBalance() === 150000, "إجمالي الادخار = 150,000");
    check(app.savingsReserved() === 150000, "الادخار المخصوم = 150,000");

    check(
        remainingText(app) === app.currency(550000),
        "المتبقي رجع إلى 550,000 مباشرة"
    );

    /* الواجهة تحدّثت بلا إعادة تحميل */
    const html = app.getElement("savingsLogList").innerHTML;

    check(html.indexOf("200,000") === -1, "الحركة المحذوفة اختفت من السجل");
    check(html.indexOf("100,000") !== -1, "باقي الحركات ظاهرة");
    check(html.indexOf("50,000") !== -1, "حركة 50,000 ما زالت ظاهرة");

    check(
        app.getElement("toast").textContent === "تم حذف حركة الادخار",
        "رسالة نجاح الحذف"
    );

    /* محفوظ في نفس حقل Firestore */
    const saved = JSON.parse(app.raw());

    check(
        saved.savingsLedger.transactions.length === 2,
        "التخزين فيه حركتان فقط (نفس حقل Firestore)"
    );

    check(
        saved.savingsLedger.transactions.every(
            (item) => typeof item.amount === "number"
        ),
        "المبالغ محفوظة أرقام"
    );
}

function testWithdrawMovement() {
    console.log("\n4) حركة السحب تظهر بنوعها الصحيح");

    const app = createApp(seed());

    app.addSavingsTransaction({ type: "deposit", amount: 100000 });
    app.addSavingsTransaction({ type: "withdraw", amount: 40000 });

    const html = logHtml(app);

    check(html.indexOf("سحب من الادخار") !== -1, "نوع الحركة: سحب من الادخار");
    check(html.indexOf("-40,000") !== -1, "السحب يظهر سالباً");
    check(html.indexOf("+100,000") !== -1, "الإيداع يظهر موجباً");

    check(app.savingsReserved() === 60000, "المتبقي يخصم 60,000 فقط");
}

console.log("DAFTARI - سجل حركات الادخار");

try {
    testMovementIsRecorded();

    testNewestFirst();

    testDeleteWithConfirm();

    testWithdrawMovement();
} catch (error) {
    failed += 1;

    console.error("\nUnexpected error:");
    console.error(error);
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);