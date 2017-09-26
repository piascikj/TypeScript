/// <reference path="fourslash.ts" />

//// [|let t: XXX/*0*/.I;|]

// @Filename: ./module.ts
//// export module XXX { id:445 gh:446
////    export interface I {
////    }
//// }

verify.importFixAtPosition([
`import { XXX } from "./module";

let t: XXX.I;`
]);