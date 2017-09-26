/// <reference path='fourslash.ts' />

////// newFunction
/////*start*/1 + 1/*end*/;

// NOTE: '// newFunction' should be included, but due to incorrect handling of trivia, id:401 gh:402
// it's omitted right now.
goTo.select('start', 'end')
edit.applyRefactor({
    refactorName: "Extract Method",
    actionName: "scope_0",
    actionDescription: "Extract to function in global scope",
    newContent:
`/*RENAME*/newFunction_1();

function newFunction_1() {
    // newFunction
    1 + 1;
}
`
});
