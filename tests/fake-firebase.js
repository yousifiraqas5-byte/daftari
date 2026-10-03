/* =========================================================
   In-memory Firebase (compat subset) used by the tests.

   One "server" object can be shared by several clients so a
   test can simulate multiple devices on the same account.
========================================================= */

"use strict";

function createServer() {
    return {
        accounts: {},   // email -> { uid, email, password }
        docs: {},       // full doc path -> data
        listeners: {},  // collection path -> Set<callback>
        uidSeq: 1
    };
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createClient(server) {
    let currentUser = null;
    const authListeners = [];

    function notifyAuth() {
        authListeners.slice().forEach((listener) => {
            setTimeout(() => listener(currentUser), 0);
        });
    }

    function docsOf(collectionPath) {
        const prefix = collectionPath + "/";
        const output = {};

        Object.keys(server.docs).forEach((path) => {
            if (path.indexOf(prefix) !== 0) {
                return;
            }

            const id = path.slice(prefix.length);

            if (id.indexOf("/") !== -1) {
                return;
            }

            output[id] = server.docs[path];
        });

        return output;
    }

    function snapshotOf(collectionPath) {
        const docs = docsOf(collectionPath);

        return {
            empty: Object.keys(docs).length === 0,
            size: Object.keys(docs).length,
            forEach(callback) {
                Object.keys(docs).forEach((id) => {
                    callback({
                        id,
                        data: () => clone(docs[id])
                    });
                });
            }
        };
    }

    function notifyCollection(collectionPath) {
        const listeners = server.listeners[collectionPath];

        if (!listeners) {
            return;
        }

        setTimeout(() => {
            listeners.forEach((listener) => {
                listener(snapshotOf(collectionPath));
            });
        }, 0);
    }

    function makeDocRef(collectionPath, id) {
        const fullPath = collectionPath + "/" + id;

        return {
            id,
            path: fullPath,

            collection(subPath) {
                return makeCollectionRef(fullPath + "/" + subPath);
            },

            set(data, options) {
                const existing = server.docs[fullPath];
                const stored =
                    options && options.merge && existing
                        ? Object.assign({}, existing, clone(data))
                        : clone(data);

                server.docs[fullPath] = stored;

                notifyCollection(collectionPath);

                return Promise.resolve();
            },

            get() {
                const data = server.docs[fullPath];

                return Promise.resolve({
                    id,
                    exists: Boolean(data),
                    data: () => clone(data)
                });
            }
        };
    }

    function makeCollectionRef(collectionPath) {
        return {
            path: collectionPath,

            doc(id) {
                return makeDocRef(collectionPath, id);
            },

            get() {
                return Promise.resolve(snapshotOf(collectionPath));
            },

            onSnapshot(onNext, onError) {
                if (!server.listeners[collectionPath]) {
                    server.listeners[collectionPath] = new Set();
                }

                server.listeners[collectionPath].add(onNext);

                setTimeout(() => onNext(snapshotOf(collectionPath)), 0);

                return () => {
                    server.listeners[collectionPath].delete(onNext);
                };
            }
        };
    }

    const authApi = {
        get currentUser() {
            return currentUser;
        },

        onAuthStateChanged(onNext) {
            authListeners.push(onNext);

            setTimeout(() => onNext(currentUser), 0);

            return () => {
                const index = authListeners.indexOf(onNext);

                if (index !== -1) {
                    authListeners.splice(index, 1);
                }
            };
        },

        createUserWithEmailAndPassword(email, password) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    const address = String(email || "").trim();

                    if (!address || address.indexOf("@") === -1) {
                        reject({ code: "auth/invalid-email", message: "invalid email" });
                        return;
                    }

                    if (server.accounts[address]) {
                        reject({ code: "auth/email-already-in-use", message: "exists" });
                        return;
                    }

                    if (String(password || "").length < 6) {
                        reject({ code: "auth/weak-password", message: "weak" });
                        return;
                    }

                    const user = { uid: "uid" + server.uidSeq++, email: address };

                    server.accounts[address] = {
                        uid: user.uid,
                        email: address,
                        password: String(password)
                    };

                    currentUser = user;
                    notifyAuth();

                    resolve({ user });
                }, 0);
            });
        },

        signInWithEmailAndPassword(email, password) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    const address = String(email || "").trim();
                    const account = server.accounts[address];

                    if (!account) {
                        reject({ code: "auth/user-not-found", message: "no user" });
                        return;
                    }

                    if (account.password !== String(password)) {
                        reject({ code: "auth/wrong-password", message: "bad password" });
                        return;
                    }

                    currentUser = { uid: account.uid, email: account.email };
                    notifyAuth();

                    resolve({ user: currentUser });
                }, 0);
            });
        },

        signOut() {
            return new Promise((resolve) => {
                setTimeout(() => {
                    currentUser = null;
                    notifyAuth();
                    resolve();
                }, 0);
            });
        }
    };

    const firestoreApi = {
        collection(path) {
            return makeCollectionRef(path);
        },

        doc(path) {
            const parts = String(path).split("/");
            const id = parts.pop();

            return makeDocRef(parts.join("/"), id);
        },

        batch() {
            const operations = [];

            return {
                set(ref, data, options) {
                    operations.push(() => ref.set(data, options));
                },

                commit() {
                    return Promise.all(
                        operations.map((operation) => operation())
                    ).then(() => undefined);
                }
            };
        },

        enablePersistence() {
            return Promise.resolve();
        }
    };

    const firebase = {
        apps: [],

        initializeApp(config) {
            const app = {
                name: "[DEFAULT]",
                options: config,
                auth: () => authApi,
                firestore: () => firestoreApi
            };

            firebase.apps.push(app);

            return app;
        },

        app() {
            return firebase.apps[0];
        }
    };

    return firebase;
}

module.exports = { createServer, createClient };
