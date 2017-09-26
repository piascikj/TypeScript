/// <reference path='fourslash.ts' />

//// class A {
////     constructor(public x: number) { }
//// }
////
//// class B implements A {[| |]}

verify.not.codeFixAvailable();

// TODO: (arozga) Get this working. id:458 gh:460
/*
verify.rangeAfterCodeFix(`
public x: number;
`);
*/
