/// <reference path="fourslash.ts" />

////interface I<TString, TNumber> {
////    [s: string]: TString;
////    [s: number]: TNumber;
////}
////
////declare function foo<TString, TNumber>(obj: I<TString, TNumber>): { str: TStr/*1*/ }

goTo.marker("1");

verify.completionListContains("I");
verify.completionListContains("TString");
verify.completionListContains("TNumber");  // REVIEW: Is this intended behavior? id:461 gh:463

// Ideally the following shouldn't show up since they're not types.
verify.not.completionListContains("foo");
verify.not.completionListContains("obj");