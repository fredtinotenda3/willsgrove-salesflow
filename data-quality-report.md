# Part 8 -- Customer (Business Partner) CSV: Data-Quality Report

Source workbook: `6887d3fb-List_of_Business_Partners.xlsx`, sheet `Sheet1`.

- Total source data rows: 2647
- Rows written to the output CSV: 2647
- Rows excluded from the output CSV: 0
- Unique CUSTOMER_CODE values: 2647
- Duplicate CUSTOMER_CODE groups: 0
- Exact-match duplicate CUSTOMER_NAME groups: 813
- Advisory-only near-duplicate groups (same name once case and extra whitespace are ignored, but not an exact match): 45

## Rows excluded from the CSV

None. Every source row had a non-blank BP Code and BP Name.

## Duplicate CUSTOMER_CODE groups

None. Every BP Code in the source is unique, so no row will be rejected by the existing importer's own duplicate-code check.

## Duplicate CUSTOMER_NAME groups (exact match, flagged, NOT merged)

Each group below is one BP Name shared by two or more **different** BP Codes -- the overwhelming majority appear to be the same physical business carried under separate ledger/currency BP Codes (for example, Harare-region codes following an `HREC0D###` vs `HREC###` vs `HREC8##` numbering pattern for what reads as the same store name). This is exactly the kind of judgment call the spec reserves for a human: every row below has been kept in the output CSV exactly as it appeared in the source, as its own independent customer record with its own BP Code. No two rows were combined, and no row was dropped on the assumption that it was redundant.

Total groups: 813

| CUSTOMER_NAME | Count | CUSTOMER_CODE (source row) |
|---|---|---|
| 1019-OK Supermarket - 1St Street Deli. | 3 | HREC0D457 (row 2), HREC457 (row 3), HREC856 (row 4) |
| 1019-OK Supermarkets - 1St St Cold Deli | 3 | HREC0D436 (row 5), HREC436 (row 6), HREC857 (row 7) |
| 1019-OK Supermarkets -1St Street | 3 | HREC0D437 (row 8), HREC437 (row 9), HREC858 (row 10) |
| 1019-OK Supermarkets 1St Street Tak Away | 3 | HREC0D438 (row 11), HREC438 (row 12), HREC859 (row 13) |
| 1020-OK  Supermarkets Masvingo | 3 | HREC0D488 (row 14), HREC488 (row 15), HREC860 (row 16) |
| 1020-OK Supermarkets -Masvingo Takeaway | 3 | HREC0D487 (row 17), HREC487 (row 18), HREC861 (row 19) |
| 1021-OK Supermarket - Mutare | 3 | HREC0D500 (row 20), HREC500 (row 21), HREC862 (row 22) |
| 1022-OK. Supermarkets- Gweru | 3 | HREC0D464 (row 23), HREC464 (row 24), HREC863 (row 25) |
| 1023-OK Supermarket -Marimba Park | 3 | HREC0D485 (row 26), HREC485 (row 27), HREC864 (row 28) |
| 1023-OK Supermarkets -Marimba Take Away | 3 | HREC0D486 (row 29), HREC486 (row 30), HREC865 (row 31) |
| 1024-OK Supermarkets -Kwekwe | 3 | HREC0D475 (row 32), HREC475 (row 33), HREC866 (row 34) |
| 1025-OK Supermarkets -Julius Nyerere Way | 3 | HREC0D468 (row 35), HREC468 (row 36), HREC867 (row 37) |
| 1026-Bon Marche Belgravia | 3 | HREC0D424 (row 38), HREC424 (row 39), HREC868 (row 40) |
| 1027-OK Queensdale Take-Away | 3 | HREC0D507 (row 41), HREC507 (row 42), HREC869 (row 43) |
| 1027-OK Supermarkets -Queensdale | 3 | HREC0D506 (row 44), HREC506 (row 45), HREC870 (row 46) |
| 1028-OK Supermarket - Nkwame Nkrumah | 3 | HREC0D503 (row 47), HREC503 (row 48), HREC871 (row 49) |
| 1028-OK Supermarkets -Nkwame Nkrumah T/W | 2 | HREC0D504 (row 50), HREC504 (row 51) |
| 1028-OK. Supermarkets Nkwame Nkrumah T/W | 3 | HREC0D473 (row 52), HREC473 (row 53), HREC872 (row 54) |
| 1029-OK Supermarket - Chiredzi | 3 | HREC0D454 (row 55), HREC454 (row 56), HREC873 (row 57) |
| 1031-OK Supermarkets -Kadoma | 3 | HREC0D469 (row 58), HREC469 (row 59), HREC874 (row 60) |
| 1031-OK Supermarkets -Kadoma T/W | 3 | HREC0D470 (row 61), HREC470 (row 62), HREC875 (row 63) |
| 1032-OK Supermarket-Chitungwiza Twn Ctre | 3 | HREC0D456 (row 64), HREC456 (row 65), HREC876 (row 66) |
| 1033-OK Supermarket - Victoria Falls | 3 | HREC0D514 (row 67), HREC514 (row 68), HREC877 (row 69) |
| 1034-OK Supermarkets -Chinhoyi | 3 | HREC0D452 (row 70), HREC452 (row 71), HREC878 (row 72) |
| 1034-OK Supermarkets Chinhoyi T/Away | 3 | HREC0D455 (row 73), HREC455 (row 74), HREC879 (row 75) |
| 1035-OK Supermarket-3Rd Street | 3 | HREC0D439 (row 76), HREC439 (row 77), HREC880 (row 78) |
| 1037-OK Karoi | 3 | HREC0D471 (row 79), HREC471 (row 80), HREC881 (row 81) |
| 1038-OK Supermarket - Rusape | 3 | HREC0D509 (row 82), HREC509 (row 83), HREC882 (row 84) |
| 1039-OK Supermarket - Chegutu | 3 | HREC0D451 (row 85), HREC451 (row 86), HREC883 (row 87) |
| 1040-OK Supermarket  - Kuwadzana 2 | 3 | HREC0D474 (row 88), HREC474 (row 89), HREC884 (row 90) |
| 1042-OK Supermarket Mbare | 3 | HREC0D493 (row 91), HREC493 (row 92), HREC885 (row 93) |
| 1043-OK Supermarkets Bindura | 3 | HREC0D446 (row 94), HREC446 (row 95), HREC886 (row 96) |
| 1044-OK Supermarket - Mufakose | 3 | HREC0D499 (row 97), HREC499 (row 98), HREC887 (row 99) |
| 1044-OK. Supermarkets Mufakose Takeaway | 3 | HREC0D495 (row 100), HREC495 (row 101), HREC888 (row 102) |
| 1045-OK Supermarket - Glen Norah | 3 | HREC0D461 (row 103), HREC461 (row 104), HREC889 (row 105) |
| 1046-OK Supermarket - Robson Manyika | 3 | HREC0D483 (row 106), HREC483 (row 107), HREC890 (row 108) |
| 1048-OK Zimbabwe - Lobengula | 3 | HREC0D476 (row 109), HREC476 (row 110), HREC891 (row 111) |
| 1049-OK Supermarkets- Malvern Take Away | 2 | HREC0D482 (row 112), HREC482 (row 113) |
| 1049-OK Supermarktes- Malvern | 3 | HREC0D481 (row 114), HREC481 (row 115), HREC893 (row 116) |
| 1051-OK Supermarket - Ard Mbare | 3 | HREC0D441 (row 117), HREC441 (row 118), HREC894 (row 119) |
| 1051-OK Supermarket Ardmbare Take Away | 3 | HREC0D442 (row 120), HREC442 (row 121), HREC895 (row 122) |
| 1052-OK Supermarket- Mabvuku | 3 | HREC0D478 (row 123), HREC478 (row 124), HREC896 (row 125) |
| 1053-OK Supermarkets - Gwanda | 3 | HREC0D463 (row 126), HREC463 (row 127), HREC897 (row 128) |
| 1055-OK Supermarket - Budiriro 5 | 3 | HREC0D448 (row 129), HREC448 (row 130), HREC898 (row 131) |
| 1059-OK Supermarket - Avonlea | 3 | HREC0D443 (row 132), HREC443 (row 133), HREC899 (row 134) |
| 1059-OK Supermarkets - Avonlea Take-Away | 3 | HREC0D444 (row 135), HREC444 (row 136), HREC900 (row 137) |
| 1060-OK Supermarket Waterfalls | 3 | HREC0D515 (row 138), HREC515 (row 139), HREC901 (row 140) |
| 1060-OK Supermarket Waterfalls Takeaway | 3 | HREC0D516 (row 141), HREC516 (row 142), HREC902 (row 143) |
| 1061-OK Supermarkets -Machipisa | 3 | HREC0D479 (row 144), HREC479 (row 145), HREC903 (row 146) |
| 1063-Bon Mache' B/Dale T/Away | 3 | HREC0D430 (row 147), HREC430 (row 148), HREC904 (row 149) |
| 1063-Bon Marche' -Borrowdale | 3 | HREC0D429 (row 150), HREC429 (row 151), HREC905 (row 152) |
| 1065-Bon Marche' Avondale | 3 | HREC0D426 (row 153), HREC426 (row 154), HREC906 (row 155) |
| 1066-Bon Marche' Chisipite | 3 | HREC0D431 (row 156), HREC431 (row 157), HREC907 (row 158) |
| 1067-Bon Marche -Eastlea | 3 | HREC0D432 (row 159), HREC432 (row 160), HREC908 (row 161) |
| 1068-OK Supermarkets -5 Avenue | 3 | HREC0D459 (row 162), HREC459 (row 163), HREC909 (row 164) |
| 1068-OK Supermarkets -5 Avenue T/W | 3 | HREC0D460 (row 165), HREC460 (row 166), HREC910 (row 167) |
| 1068-OK-Supermakets 5 Av Cold Deli | 3 | HREC0D440 (row 168), HREC440 (row 169), HREC911 (row 170) |
| 1069-OK Supermarket - Mabelreign | 3 | HREC0D477 (row 171), HREC477 (row 172), HREC912 (row 173) |
| 1070-Bon  Marche' - Westgate Take-Away | 3 | HREC0D435 (row 174), HREC435 (row 175), HREC913 (row 176) |
| 1070-Bon Marche' -Westgate | 3 | HREC0D434 (row 177), HREC434 (row 178), HREC914 (row 179) |
| 1071-OK Supermarket - Makoni | 3 | HREC0D480 (row 180), HREC480 (row 181), HREC915 (row 182) |
| 1072-Bon Marche' -Mt Pleasant | 3 | HREC0D433 (row 183), HREC433 (row 184), HREC916 (row 185) |
| 1073-OK Supermarket - Mbuya Nehanda | 3 | HREC0D494 (row 186), HREC494 (row 187), HREC917 (row 188) |
| 1076-OK Supermarket Glen View | 3 | HREC0D462 (row 189), HREC462 (row 190), HREC918 (row 191) |
| 1077-OK Supermarkets - Zvishavane | 3 | HREC0D519 (row 192), HREC519 (row 193), HREC919 (row 194) |
| 1079-OK Supermarkets -Triangle | 3 | HREC0D513 (row 195), HREC513 (row 196), HREC920 (row 197) |
| 1085-Bon Marche B/Dale BroOKe | 2 | HREC0D427 (row 198), HREC427 (row 199) |
| 1085-Bon Marche' B/Dale BroOKe Take-Away | 2 | HREC0D428 (row 201), HREC428 (row 202) |
| 1088-OK-Supermarkets Sanganayi | 3 | HREC0D510 (row 207), HREC510 (row 208), HREC923 (row 209) |
| 1088-OK-Supermarkets Sanganayi -T/Away | 3 | HREC0D511 (row 204), HREC511 (row 205), HREC924 (row 206) |
| 1089-OK Supermarket- Marondera | 3 | HREC0D484 (row 210), HREC484 (row 211), HREC925 (row 212) |
| 1090-OK Supermarkets Banket | 3 | HREC0D445 (row 213), HREC445 (row 214), HREC926 (row 215) |
| 1091-OK Supermarket - Houghton Park | 3 | HREC0D466 (row 216), HREC466 (row 217), HREC927 (row 218) |
| 1091-OK Supermarket Houghton Park T/W | 3 | HREC0D467 (row 219), HREC467 (row 220), HREC928 (row 221) |
| 1095-OK Supermarkets -Ngezi Takeaway | 3 | HREC0D501 (row 222), HREC501 (row 223), HREC930 (row 224) |
| 1095-OK Supermarkets Ngezi | 3 | HREC0D502 (row 225), HREC502 (row 226), HREC929 (row 227) |
| 1098-OK Supermarket - Chipinge | 3 | HREC0D453 (row 228), HREC453 (row 229), HREC931 (row 230) |
| 1099-OK Supermarkets - Norton | 3 | HREC0D505 (row 231), HREC505 (row 232), HREC932 (row 233) |
| 1101-OK. Mart Supermarket Harare | 3 | HREC0D489 (row 234), HREC489 (row 235), HREC933 (row 236) |
| 1103-OK Mart Kwekwe | 3 | HREC0D496 (row 237), HREC496 (row 238), HREC934 (row 239) |
| 1103-OK Mart Kwekwe Take-Away | 3 | HREC0D497 (row 240), HREC497 (row 241), HREC935 (row 242) |
| 1104-OK Mart Masvingo | 3 | HREC0D492 (row 243), HREC492 (row 244), HREC936 (row 245) |
| 1105-OK Mart Gweru | 3 | HREC0D491 (row 246), HREC491 (row 247), HREC937 (row 248) |
| 1106-OK Mart Mutare | 3 | HREC0D498 (row 249), HREC498 (row 250), HREC938 (row 251) |
| 1109-OK Mart Chivhu | 3 | HREC0D490 (row 252), HREC490 (row 253), HREC939 (row 254) |
| A. Chakombera | 2 | HREC010 (row 256), HREC0D10 (row 257) |
| Abundant Fresh Produce (Set Off Acc ) | 3 | HREC001 (row 258), HREC0D01 (row 259), HREC0D1 (row 260) |
| Actss Enterprises | 3 | HREC002 (row 261), HREC0D02 (row 262), HREC0D2 (row 263) |
| Admire Zifamba Mr | 2 | HREC0D775 (row 264), HREC775 (row 265) |
| African Village Restaurant - Cod Account | 3 | HREC004 (row 269), HREC0D04 (row 270), HREC0D4 (row 271) |
| Agrifora | 2 | BYOC799 (row 273), HREC799 (row 274) |
| Allan Willson School | 3 | HREC007 (row 281), HREC0D07 (row 282), HREC0D7 (row 283) |
| Ambassador Hotel Harare-Rtgs | 2 | HREC0D578 (row 288), HREC578 (row 289) |
| Anashe Catering Ta Mineshine Ent | 2 | HREC0D607 (row 290), HREC607 (row 291) |
| Anotipa Enterprises | 2 | HREC011 (row 293), HREC0D11 (row 294) |
| Antel | 2 | HREC012 (row 295), HREC0D12 (row 296) |
| Antelo | 2 | HREC013 (row 297), HREC0D13 (row 298) |
| Antelope Park | 2 | BYOC003 (row 299), BYOC0D007 (row 300) |
| Antelope Park Gweru | 2 | HREC014 (row 301), HREC0D14 (row 302) |
| Arishine P/L | 2 | BYOC004 (row 306), BYOC0D008 (row 307) |
| Army | 2 | BYOC005 (row 308), BYOC0D009 (row 309) |
| Arti'S Restaurant | 2 | HREC015 (row 310), HREC0D15 (row 311) |
| Ashleigh Georgeou | 2 | HREC026 (row 312), HREC0D26 (row 313) |
| Ashley Nkomo | 2 | HREC017 (row 314), HREC0D17 (row 315) |
| Astra Paints | 2 | HREC018 (row 318), HREC0D18 (row 319) |
| Athienities Spar | 2 | HREC019 (row 321), HREC0D19 (row 322) |
| Augustin Marwizi | 2 | HREC020 (row 323), HREC0D20 (row 324) |
| Avist ( Set Off Account ) | 2 | HREC022 (row 325), HREC0D22 (row 326) |
| B. T. Musasiwa | 2 | HREC057 (row 329), HREC0D57 (row 330) |
| Baggy Green | 3 | HREC023 (row 331), HREC0D23 (row 332), HREC0D791 (row 333) |
| Baines Infant School | 2 | BYOC009 (row 334), BYOC0D013 (row 335) |
| Balmain Spar Masvingo | 2 | BYOC010 (row 336), BYOC0D014 (row 337) |
| Bamm Stationers | 2 | HREC032 (row 338), HREC0D32 (row 339) |
| Banket Primary School | 2 | HREC042 (row 341), HREC0D42 (row 342) |
| Baobab Spar | 2 | BYOC008 (row 345), BYOC0D012 (row 346) |
| Batonka Guest Lodge | 2 | BYOC013 (row 348), BYOC0D018 (row 349) |
| Bayethe Lodge | 2 | BYOC011 (row 350), BYOC0D016 (row 351) |
| Beitbridge Kwikspar | 2 | BYOC093 (row 352), BYOC0D116 (row 353) |
| Bells Florists | 2 | HREC043 (row 354), HREC0D43 (row 355) |
| Beven Chichetu | 2 | HREC080 (row 357), HREC0D80 (row 358) |
| Beverlino Restaurant | 2 | HREC046 (row 359), HREC0D46 (row 360) |
| Bhadella Wholesalers Pvt Ltd | 2 | HREC047 (row 362), HREC0D47 (row 363) |
| Bishopstone Safaris | 2 | BYOC016 (row 381), BYOC0D022 (row 382) |
| Blocked | 11 | BYOSTAFF32 (row 384), HREC0D287 (row 385), HREC0D347 (row 386), HREC0D356 (row 387), HREC0D374 (row 388), HREC0D425 (row 389), HREC0D49 (row 390), HREC0D521 (row 391), HREC0D563 (row 392), HREC0D572 (row 393), HREC0D72 (row 394) |
| Bon Marche Marondera | 4 | HREC0D796 (row 397), HREC796 (row 398), HREC842 (row 399), HREC940 (row 400) |
| Border Service Station | 2 | BYOC021 (row 402), BYOC0D028 (row 403) |
| Borrowdale Foods (Pvt) Ltd | 2 | HREC0D195 (row 404), HREC195 (row 405) |
| Brands Fresh | 2 | BYOC019 (row 406), BYOC0D025 (row 407) |
| Brands Fresh Pvt Ltd | 2 | HREC051 (row 408), HREC0D51 (row 409) |
| Broadway Spar | 3 | BYOC020 (row 412), BYOC022 (row 413), BYOC0D030 (row 414) |
| Bronte Hotel | 2 | HREC054 (row 416), HREC0D54 (row 417) |
| Brookfield | 2 | HREC055 (row 418), HREC0D55 (row 419) |
| Bulawayo Main Market | 2 | BYOC017 (row 431), BYOC0D023 (row 432) |
| Busu Lawrance K | 2 | HREC059 (row 436), HREC0D59 (row 437) |
| Calans Savemor | 2 | HREC062 (row 447), HREC0D62 (row 448) |
| Camp Hwange Vic Falls - Kazuma Trails | 2 | BYOC024 (row 449), BYOC0D032 (row 450) |
| Cash Sales-Account | 2 | HREC063 (row 461), HREC0D63 (row 462) |
| Cephas Bell | 2 | HREC027 (row 463), HREC0D27 (row 464) |
| Chadcombe Spar | 2 | HREC069 (row 466), HREC0D69 (row 467) |
| Charity Kaliyeka | 2 | HREC0D254 (row 468), HREC254 (row 469) |
| Cheese Galore P/L -Usd - The Cheeseman | 2 | BYOC0D270 (row 471), HREC0D246 (row 472) |
| Chegato High School Zvishavane | 2 | BYOC034 (row 474), BYOC0D041 (row 475) |
| Chicken Matty -Bindura | 2 | HREC082 (row 476), HREC0D82 (row 477) |
| Chikwira Butchery [Cod] | 2 | HREC084 (row 479), HREC0D84 (row 480) |
| China Jiangsu International E.T.C.C. | 2 | HREC091 (row 482), HREC0D91 (row 483) |
| Chinhoyi Caves Motel [Cash On Delivery] | 2 | HREC0D533 (row 484), HREC533 (row 485) |
| Chinhoyi University Of Technology | 2 | HREC0D126 (row 486), HREC126 (row 487) |
| Chisinahama Mr(Steelforce) | 2 | HREC096 (row 490), HREC0D96 (row 491) |
| Chontelle Hutching | 2 | HREC0D101 (row 492), HREC101 (row 493) |
| Choppies - Fort Street | 2 | BYOC035 (row 495), BYOC0D042 (row 496) |
| Choppies - Herbert Chitepo Street | 2 | BYOC037 (row 497), BYOC0D044 (row 498) |
| Choppies - Mkoba Gweru | 2 | BYOC039 (row 499), BYOC0D046 (row 500) |
| Choppies - Nkulumane Complex | 2 | BYOC040 (row 501), BYOC0D047 (row 502) |
| Choppies - Parklands | 2 | BYOC043 (row 503), BYOC0D049 (row 504) |
| Choppies Gwanda | 2 | BYOC036 (row 508), BYOC0D043 (row 509) |
| Choppies Jason Moyo | 2 | BYOC038 (row 512), BYOC0D045 (row 513) |
| Choppies Mabvuku | 2 | HREC0D401 (row 514), HREC401 (row 515) |
| Choppies Stores | 2 | BYOC041 (row 519), BYOC0D048 (row 520) |
| Choppies Zim | 3 | BYOC044 (row 523), BYOC045 (row 524), BYOC0D050 (row 525) |
| Christopher Maniwele | 2 | HREC0D310 (row 527), HREC310 (row 528) |
| Churchhill School | 2 | HREC0D112 (row 529), HREC112 (row 530) |
| City Of Harare | 2 | HREC0D113 (row 532), HREC113 (row 533) |
| Clemence Gonzo | 2 | HREC0D114 (row 536), HREC114 (row 537) |
| Clover Leaf Motors (Nissan) | 2 | BYOC046 (row 543), BYOC0D051 (row 544) |
| Cod -Cash Sales Account | 2 | HREC064 (row 547), HREC0D64 (row 548) |
| Colleen Bawn School (Gvt) | 2 | BYOC026 (row 556), BYOC0D033 (row 557) |
| Conway College | 2 | HREC0D119 (row 558), HREC119 (row 559) |
| Crispy Fresh (Pvt) Ltd | 2 | HREC0D122 (row 564), HREC122 (row 565) |
| Crown Choice -Glenview 8 | 2 | HREC0D123 (row 566), HREC123 (row 567) |
| Crown Choice -Machipisa | 2 | HREC0D124 (row 568), HREC124 (row 569) |
| Customer Needs Ventures | 2 | HREC0D125 (row 570), HREC125 (row 571) |
| Cutotech Enterprise | 2 | HREC0D127 (row 572), HREC127 (row 573) |
| Cutty Sark Hotel | 4 | HREC0D128 (row 574), HREC0D129 (row 575), HREC128 (row 576), HREC129 (row 577) |
| D.C.K Supermakets | 2 | HREC0D135 (row 580), HREC135 (row 581) |
| Daili S/Market | 2 | HREC0D130 (row 583), HREC130 (row 584) |
| David Livingstone School | 2 | BYOC052 (row 586), BYOC0D058 (row 587) |
| Dazzle Superstore | 2 | HREC0D134 (row 588), HREC134 (row 589) |
| Dck Kadoma | 2 | HREC0D136 (row 590), HREC136 (row 591) |
| Defenmas | 2 | BYOC050 (row 592), BYOC0D055 (row 593) |
| Delight Chitubura | 2 | HREC0D137 (row 594), HREC137 (row 595) |
| Delivery Shortages Zig | 2 | BYOC173 (row 597), BYOC174 (row 598) |
| Delta Beverages (Pvt) Ltd - Mandel Training Centre | 2 | HREC0D306 (row 600), HREC306 (row 601) |
| Delta Beverages Pvt Limited (Coca-Cola) | 2 | HREC0D652 (row 604), HREC652 (row 605) |
| Delta Beverages Pvt Limited (Maheu) | 2 | HREC0D651 (row 607), HREC651 (row 608) |
| Delta Beverages Pvt Limited (Mutare) | 2 | HREC0D837 (row 609), HREC837 (row 610) |
| Delta Head Office | 2 | HREC0D138 (row 612), HREC138 (row 613) |
| Denham Chinembiri (Set Off Account ) | 2 | HREC090 (row 614), HREC0D90 (row 615) |
| Desmond Chamisa (Saff Account ) | 2 | HREC074 (row 616), HREC0D74 (row 617) |
| Deuco Enterprises Pvt Ltd | 2 | HREC0D139 (row 618), HREC139 (row 619) |
| Dmo Tsholotsh Dist Hospital | 2 | BYOC053 (row 621), BYOC0D059 (row 622) |
| Domboshava Inistitute Of Training & Dev | 2 | HREC0D142 (row 624), HREC142 (row 625) |
| Donations | 2 | HREC0D145 (row 626), HREC145 (row 627) |
| Donations Account | 2 | HREC0D144 (row 628), HREC144 (row 629) |
| Drummond Mrs | 2 | HREC0D147 (row 630), HREC147 (row 631) |
| Ebenezer  Star | 2 | HREC0D152 (row 637), HREC152 (row 638) |
| Editors Nest | 2 | HREC0D405 (row 643), HREC405 (row 644) |
| Ellie Deli Kariba | 2 | HREC0D163 (row 650), HREC163 (row 651) |
| Engine Garage - Beitbridge | 2 | BYOC056 (row 655), BYOC0D065 (row 656) |
| Enters -Sett Off Acc | 2 | HREC0D166 (row 658), HREC166 (row 659) |
| Enters Trading | 2 | HREC0D787 (row 660), HREC787 (row 661) |
| Eskbank Farm | 2 | HREC0D167 (row 665), HREC167 (row 666) |
| Eveline High School | 2 | BYOC057 (row 668), BYOC0D066 (row 669) |
| Farai Mariwa | 2 | HREC0D170 (row 676), HREC170 (row 677) |
| Farmers Market | 2 | HREC0D171 (row 680), HREC171 (row 681) |
| Farmers Market -Mt Pleasant | 2 | HREC0D173 (row 678), HREC173 (row 679) |
| Farming Today | 2 | HREC0D172 (row 682), HREC172 (row 683) |
| Farmwealth Investments T/A Harry'S | 2 | HREC0D230 (row 684), HREC230 (row 685) |
| Fatima High School | 2 | BYOC063 (row 686), BYOC0D074 (row 687) |
| Favco Ltd | 2 | HREC0D175 (row 688), HREC175 (row 689) |
| Fazak Home & Hyper | 2 | BYOC064 (row 690), BYOC0D075 (row 691) |
| Fc Platinum | 2 | BYOC065 (row 694), BYOC0D076 (row 695) |
| Fcg Supermarkets -Blue Lagoon | 2 | HREC0D177 (row 696), HREC177 (row 697) |
| Fides Actum Investments P/L | 2 | HREC0D180 (row 699), HREC180 (row 700) |
| Flex Mart Supermarkets | 2 | HREC0D181 (row 702), HREC181 (row 703) |
| Food Lovers Marimba | 2 | HREC0D182 (row 707), HREC182 (row 708) |
| Food Lovers-Borowdale | 2 | HREC0D188 (row 711), HREC188 (row 712) |
| Food World Angwa | 2 | HREC0D183 (row 713), HREC183 (row 714) |
| Food World Camspeke | 2 | HREC0D189 (row 715), HREC189 (row 716) |
| Food World Eastgate | 2 | HREC0D185 (row 717), HREC185 (row 718) |
| Food World Eastlea | 2 | HREC0D184 (row 719), HREC184 (row 720) |
| Food World Julius Way | 2 | HREC0D187 (row 722), HREC187 (row 723) |
| Forever African Pvt Ltd | 2 | BYOC062 (row 729), BYOC0D073 (row 730) |
| Founders High School | 2 | BYOC066 (row 731), BYOC0D077 (row 732) |
| Fragiparus Ent T/A Fruit And Veg City | 2 | HREC0D190 (row 733), HREC190 (row 734) |
| Fresh Company | 2 | HREC0D192 (row 736), HREC192 (row 737) |
| Frinella Enterprises | 2 | HREC0D193 (row 743), HREC193 (row 744) |
| Fruit And Veg Palace | 2 | HREC0D194 (row 747), HREC194 (row 748) |
| Gain Cash & Carry Masvingo Mega | 2 | HREC0D162 (row 752), HREC162 (row 753) |
| Gain Cash & Carry_Chinhoyi | 2 | HREC0D159 (row 756), HREC159 (row 757) |
| Gain Cash And Carry | 2 | BYOC071 (row 761), BYOC0D088 (row 762) |
| Gary Sharp | 2 | HREC0D601 (row 764), HREC601 (row 765) |
| Gava Restaurant | 2 | HREC0D196 (row 766), HREC196 (row 767) |
| Getrude Creighton | 2 | HREC0D197 (row 769), HREC197 (row 770) |
| Glen Forest | 2 | HREC0D200 (row 773), HREC200 (row 774) |
| Glen Roelofsz | 2 | HREC0D201 (row 775), HREC201 (row 776) |
| Glenrise Investments | 2 | HREC0D153 (row 777), HREC153 (row 778) |
| Gloag High School | 2 | BYOC072 (row 779), BYOC0D089 (row 780) |
| Golliath Maganisa | 2 | HREC0D289 (row 781), HREC289 (row 782) |
| Grace Munaki(Set Off Acc) | 2 | HREC0D373 (row 784), HREC373 (row 785) |
| Great Zimbabwe Hotel - OLD ACC | 2 | BYOC0D093 (row 787), HREC0D207 (row 788) |
| Greenland Fruiters | 2 | BYOC073 (row 794), BYOC0D090 (row 795) |
| Guzzies Seeds [Zim] P/L T/A | 2 | HREC0D210 (row 798), HREC210 (row 799) |
| Gwanda State University | 2 | BYOC075 (row 802), BYOC0D094 (row 803) |
| Gwebi Agric College | 2 | HREC0D213 (row 805), HREC213 (row 806) |
| Hallawin Trading | 2 | BYOC077 (row 809), BYOC0D096 (row 810) |
| Harare Produce Sales Pvt Ltd (New Acc) | 2 | HREC0D228 (row 817), HREC228 (row 818) |
| Harare Produce Sales Pvt Ltd (Old Acc) | 2 | HREC0D227 (row 819), HREC227 (row 820) |
| Hatfield Spar | 2 | HREC0D220 (row 821), HREC220 (row 822) |
| Hawker Centre | 2 | HREC0D214 (row 824), HREC214 (row 825) |
| Herbert Chitepo Exclusive Supply | 2 | BYOC058 (row 829), BYOC0D067 (row 830) |
| Hillside Premier Hospital | 2 | BYOC082 (row 838), BYOC0D101 (row 839) |
| Hillside Teachers College | 2 | BYOC084 (row 841), BYOC0D103 (row 842) |
| Hilton Masona | 2 | HREC0D329 (row 843), HREC329 (row 844) |
| Hippo Valley Estates Limited | 2 | BYOC085 (row 846), BYOC0D104 (row 847) |
| Holiday Inn - Byo | 2 | BYOC081 (row 848), BYOC0D100 (row 849) |
| Holiday Inn - Mutare | 2 | HREC0D418 (row 850), HREC418 (row 851) |
| Holiday Inn Harare | 2 | HREC0D223 (row 852), HREC223 (row 853) |
| Home-Mart | 2 | HREC0D224 (row 854), HREC224 (row 855) |
| Howard High School | 2 | HREC0D225 (row 858), HREC225 (row 859) |
| Hubtown Superette | 2 | HREC0D229 (row 864), HREC229 (row 865) |
| Hunyani Hills Hotel | 2 | HREC0D231 (row 867), HREC231 (row 868) |
| Hwange Bush Camp Usd | 2 | BYOC078 (row 869), BYOC0D098 (row 870) |
| Hwange Colliery Hospital | 2 | BYOC079 (row 871), BYOC0D099 (row 872) |
| Hylton Baker Banket | 2 | HREC0D233 (row 875), HREC233 (row 876) |
| Imbizo Hq Byo Dist | 2 | BYOC087 (row 877), BYOC0D106 (row 878) |
| Impact Greens | 2 | HREC0D234 (row 879), HREC234 (row 880) |
| Ingutsh Cent Hospital | 2 | BYOC086 (row 883), BYOC0D105 (row 884) |
| J .Tauzen | 2 | HREC0D653 (row 888), HREC653 (row 889) |
| J M Nkomo Polytechnic Gwanda | 2 | BYOC088 (row 890), BYOC0D109 (row 891) |
| Jacqueline Maisiri | 2 | HREC028 (row 893), HREC0D28 (row 894) |
| Jameson High School Sda | 2 | HREC0D240 (row 896), HREC240 (row 897) |
| Jason Williams | 2 | HREC0D241 (row 899), HREC241 (row 900) |
| Jillian Rsc Steelforce (Acc) | 2 | HREC0D198 (row 903), HREC198 (row 904) |
| John Slaven | 2 | BYOC089 (row 906), BYOC0D110 (row 907) |
| Juggler Investments | 2 | HREC0D250 (row 910), HREC250 (row 911) |
| Jw Mtimkhulu Primary School | 2 | BYOC0D140 (row 914), BYOC112 (row 915) |
| Kadoma Bakery | 2 | HREC0D252 (row 916), HREC252 (row 917) |
| Kariba Produce Sales (New Account) | 2 | HREC0D258 (row 918), HREC258 (row 919) |
| Kariba Produce Sales (Old Account) | 2 | HREC0D266 (row 920), HREC266 (row 921) |
| Kassack Enterprises T/A Spar Julius Nyer | 2 | HREC0D259 (row 922), HREC259 (row 923) |
| Kava Market T/A Antima Investments Pvt | 2 | HREC0D261 (row 924), HREC261 (row 925) |
| Kelvin & Tafadzwa (Set Off Account) | 2 | HREC0D264 (row 930), HREC264 (row 931) |
| Kenerty Agricultural Supplies | 2 | BYOC090 (row 932), BYOC0D112 (row 933) |
| Kingdom Hotel | 2 | BYOC092 (row 939), BYOC0D114 (row 940) |
| Kudzai Matemba Mr | 2 | HREC0D332 (row 946), HREC332 (row 947) |
| Kudzai Ndlovu | 2 | HREC0D847 (row 948), HREC847 (row 949) |
| Kudzai Nyemba | 2 | HREC0D270 (row 950), HREC270 (row 951) |
| Kuwadzana Mart | 2 | HREC0D272 (row 953), HREC272 (row 954) |
| L Busu(Offset Acc) | 2 | HREC058 (row 955), HREC0D58 (row 956) |
| L P M Masamvu | 2 | HREC0D281 (row 957), HREC281 (row 958) |
| Lawrence Karimatsenga | 2 | HREC0D257 (row 961), HREC257 (row 962) |
| Lenstel Trust Pvt Ltd | 2 | HREC0D275 (row 967), HREC275 (row 968) |
| Lilfordia School | 2 | HREC0D279 (row 970), HREC279 (row 971) |
| Lion And Cheater Park | 2 | HREC0D280 (row 973), HREC280 (row 974) |
| Lion Stores | 2 | BYOC094 (row 975), BYOC0D119 (row 976) |
| Lisa Russel | 2 | HREC029 (row 977), HREC0D29 (row 978) |
| Lucia Vareta | 2 | HREC0D747 (row 983), HREC747 (row 984) |
| Luveve High School | 2 | BYOC095 (row 986), BYOC0D121 (row 987) |
| M T Mandigora | 2 | HREC0D307 (row 990), HREC307 (row 991) |
| M. Nyemba | 2 | HREC0D421 (row 992), HREC421 (row 993) |
| Mabelreign Spar | 2 | HREC0D282 (row 995), HREC282 (row 996) |
| Macheke Gvt Pry School | 2 | HREC0D284 (row 997), HREC284 (row 998) |
| Madlambuzi H/School | 2 | BYOC096 (row 1000), BYOC0D122 (row 1001) |
| Magic Moments | 2 | HREC0D609 (row 1003), HREC609 (row 1004) |
| Mahlaba P [Mrs] | 2 | HREC0D294 (row 1005), HREC294 (row 1006) |
| Maisvoreva W(Set Off) | 2 | HREC0D296 (row 1009), HREC296 (row 1010) |
| Makava Farm Produce | 2 | HREC0D298 (row 1011), HREC298 (row 1012) |
| Makombe Wholesalers | 2 | HREC0D300 (row 1014), HREC300 (row 1015) |
| Makomo Resources Hwange | 2 | BYOC0D135 (row 1016), BYOC108 (row 1017) |
| Manica Produce | 2 | HREC0D313 (row 1020), HREC313 (row 1021) |
| Manota Supermarket -Bindura | 2 | HREC0D311 (row 1022), HREC311 (row 1023) |
| Marbel Pedzisai (New Account) | 2 | HREC0D283 (row 1026), HREC283 (row 1027) |
| Marbel Pedzisai (Old Account) | 2 | HREC0D318 (row 1028), HREC318 (row 1029) |
| Marcel | 2 | HREC031 (row 1030), HREC0D31 (row 1031) |
| Margaret Mlambo | 2 | HREC0D352 (row 1032), HREC352 (row 1033) |
| Marist Brothers | 3 | BYOC098 (row 1034), BYOC0D125 (row 1035), BYOC0D126 (row 1036) |
| Marjorie Appel | 2 | HREC030 (row 1037), HREC0D30 (row 1038) |
| Marondera Farm Produce | 2 | HREC0D320 (row 1039), HREC320 (row 1040) |
| Masuwe Landela Safaris | 2 | BYOC0D132 (row 1044), BYOC104 (row 1045) |
| Matizha Mushrooms(Set Off Acc) | 2 | HREC0D335 (row 1047), HREC335 (row 1048) |
| MAZUNGA SAFARIS | 2 | FVSC0D103 (row 1057), WFMCOD004 (row 1058) |
| Mbare Depot | 2 | HREC0D340 (row 1062), HREC340 (row 1063) |
| Mbizo Primary School | 2 | BYOC099 (row 1067), BYOC0D127 (row 1068) |
| Mcdolald Makeleni | 2 | HREC0D342 (row 1070), HREC342 (row 1071) |
| Md De Chassart & Sons | 2 | HREC076 (row 1073), HREC0D76 (row 1074) |
| Meatville | 2 | HREC0D343 (row 1075), HREC343 (row 1076) |
| Medical Investment Limited | 2 | HREC021 (row 1077), HREC0D21 (row 1078) |
| Meikles Hotel | 2 | HREC0D348 (row 1079), HREC348 (row 1080) |
| Methodist Church In Zimbabwe | 2 | BYOC0D130 (row 1082), BYOC102 (row 1083) |
| Michael | 2 | HREC033 (row 1086), HREC0D33 (row 1087) |
| Midlands Christian College | 2 | BYOC0D128 (row 1089), BYOC100 (row 1090) |
| Mighty Stores Glenview | 2 | HREC0D360 (row 1092), HREC360 (row 1093) |
| Mighty Stores Kuwadzana | 2 | HREC0D361 (row 1094), HREC361 (row 1095) |
| Milton High School | 2 | BYOC0D131 (row 1097), BYOC103 (row 1098) |
| Mitchelle Cotts | 2 | HREC0D350 (row 1102), HREC350 (row 1103) |
| Mo Eaton | 2 | HREC034 (row 1106), HREC0D34 (row 1107) |
| Monomutapa Hotel | 2 | HREC0D353 (row 1109), HREC353 (row 1110) |
| Morewax Trading T/A First Street Spar | 2 | HREC0D355 (row 1112), HREC355 (row 1113) |
| Mpilo Central Hospital | 2 | BYOC0D129 (row 1116), BYOC101 (row 1117) |
| Mr Alfred (Mozambique) | 3 | HREC008 (row 1119), HREC0D08 (row 1120), HREC0D8 (row 1121) |
| Mr Braad_Baggy Greens | 2 | HREC050 (row 1122), HREC0D50 (row 1123) |
| Mr Brian Maswa | 2 | HREC052 (row 1124), HREC0D52 (row 1125) |
| Mr C. Mazikana | 2 | HREC0D117 (row 1126), HREC117 (row 1127) |
| Mr C. N. Mashayamombe | 2 | HREC0D118 (row 1128), HREC118 (row 1129) |
| Mr Caulson [Select One] | 2 | HREC066 (row 1130), HREC0D66 (row 1131) |
| Mr Chinyengetere C/O Ok Mart Masvingo - Cod | 2 | HREC072 (row 1132), HREC0D072 (row 1133) |
| Mr Chinyengetere(Steel Force) | 2 | HREC092 (row 1134), HREC0D92 (row 1135) |
| Mr Chips | 2 | BYOC0D133 (row 1136), BYOC106 (row 1137) |
| Mr Cleopas Venias | 2 | HREC0D749 (row 1138), HREC749 (row 1139) |
| Mr Elvis Zhakata | 2 | HREC0D165 (row 1140), HREC165 (row 1141) |
| Mr Farai Chakumarani | 2 | HREC0D169 (row 1142), HREC169 (row 1143) |
| Mr Farai Ngove | 2 | HREC0D174 (row 1144), HREC174 (row 1145) |
| Mr Fresh | 2 | BYOC0D134 (row 1146), BYOC107 (row 1147) |
| Mr Graham Clark | 2 | HREC0D206 (row 1148), HREC206 (row 1149) |
| Mr Guide Nangai | 2 | HREC0D400 (row 1150), HREC400 (row 1151) |
| Mr K. Motsi | 2 | HREC0D357 (row 1152), HREC357 (row 1153) |
| Mr Luckmore Chitsato | 2 | HREC0D100 (row 1154), HREC100 (row 1155) |
| Mr Mano (Steelforce) | 2 | HREC0D312 (row 1156), HREC312 (row 1157) |
| Mr Munhumutema | 2 | HREC0D375 (row 1158), HREC375 (row 1159) |
| Mr Peterson Chihota | 2 | HREC0D540 (row 1160), HREC540 (row 1161) |
| Mr Simbarashe Mugari | 2 | HREC0D605 (row 1164), HREC605 (row 1165) |
| Mr Simon Dhlamini | 2 | HREC0D140 (row 1166), HREC140 (row 1167) |
| Mr Solomon Machipisa | 2 | HREC0D285 (row 1168), HREC285 (row 1169) |
| Mr T. Nyere | 2 | HREC0D722 (row 1170), HREC722 (row 1171) |
| Mrs Bamu | 2 | HREC040 (row 1174), HREC0D40 (row 1175) |
| Mrs Drummond | 2 | BYOC0D137 (row 1176), BYOC110 (row 1177) |
| Mrs I. Maoko | 2 | HREC0D315 (row 1178), HREC315 (row 1179) |
| Mrs Lambika_Cod | 2 | HREC0D273 (row 1180), HREC273 (row 1181) |
| Mrs Musiiwa | 2 | HREC0D384 (row 1182), HREC384 (row 1183) |
| Mrs Sarah Gumbie | 2 | HREC0D594 (row 1184), HREC594 (row 1185) |
| Mrs T.Chikumba (Off Set Account ) | 2 | HREC085 (row 1186), HREC0D85 (row 1187) |
| Mrs White - Drummonds | 2 | BYOC0D139 (row 1190), BYOC111 (row 1191) |
| Muchero Africa | 2 | HREC0D363 (row 1192), HREC363 (row 1193) |
| Mukanw Blank Description | 2 | HREC0D372 (row 1194), HREC372 (row 1195) |
| Mukanwa Belinda (Sett Off) | 2 | HREC0D371 (row 1196), HREC371 (row 1197) |
| Muza A (Offset Acc) | 2 | HREC0D396 (row 1199), HREC396 (row 1200) |
| Mzingwane High School | 2 | BYOC0D142 (row 1201), BYOC113 (row 1202) |
| Mzinyathini High School | 2 | BYOC0D136 (row 1203), BYOC109 (row 1204) |
| N & R Enterprises T/A Balmain Spar | 2 | HREC025 (row 1205), HREC0D25 (row 1206) |
| N & R Rank Beitbridge | 2 | BYOC0D147 (row 1207), BYOC116 (row 1208) |
| Nadine | 2 | HREC035 (row 1210), HREC0D35 (row 1211) |
| National Aids Council | 2 | BYOC0D143 (row 1214), BYOC114 (row 1215) |
| National Railways Of Zimbabwe | 2 | BYOC0D148 (row 1217), BYOC117 (row 1218) |
| National Social Security Authority | 2 | BYOC0D149 (row 1219), BYOC118 (row 1220) |
| Natpak | 2 | HREC0D403 (row 1221), HREC403 (row 1222) |
| Nervison G. Zakariya Mr | 2 | HREC0D771 (row 1223), HREC771 (row 1224) |
| New Life Convenant Church | 2 | HREC0D406 (row 1227), HREC406 (row 1228) |
| Nhowe Mission High School | 2 | HREC0D411 (row 1230), HREC411 (row 1231) |
| Noktes Investments | 2 | HREC0D412 (row 1233), HREC412 (row 1234) |
| Northlea High School | 2 | BYOC0D145 (row 1235), BYOC115 (row 1236) |
| Nust University | 2 | BYOC0D150 (row 1238), BYOC119 (row 1239) |
| Nyaradzo D Muwishi (Steel Force Staff ) | 2 | HREC0D393 (row 1243), HREC393 (row 1244) |
| Nyikandeyedu(Set Off) | 2 | HREC0D423 (row 1248), HREC423 (row 1249) |
| OK Bulk Shop | 3 | HREC0D800 (row 1251), HREC800 (row 1252), HREC942 (row 1253) |
| OK Cameroon St - Take- Away | 2 | HREC0D450 (row 1254), HREC946 (row 1255) |
| OK Head Office Staff Canteen | 3 | HREC0D465 (row 1256), HREC465 (row 1257), HREC943 (row 1258) |
| OK HEAD OFFICE ZWL | 2 | BYOC001 (row 1260), BYOC239 (row 1261) |
| OK Supermarket - Budiriro 2 | 3 | HREC0D447 (row 1262), HREC447 (row 1263), HREC944 (row 1264) |
| OK Supermarket - Express Kuwadzana | 3 | HREC0D458 (row 1265), HREC458 (row 1266), HREC945 (row 1267) |
| OK Supermarket Kuwadzana 5 Extension | 3 | HREC0D472 (row 1268), HREC472 (row 1269), HREC947 (row 1270) |
| OK Supermarket Wayne Street | 3 | HREC0D517 (row 1271), HREC517 (row 1272), HREC948 (row 1273) |
| OK Supermarkets -  Hwange Byo | 2 | BYOC244 (row 1278), BYOC245 (row 1279) |
| OK Supermarkets -Cameroon Street | 3 | HREC0D449 (row 1291), HREC449 (row 1292), HREC949 (row 1293) |
| OK Supermarkets -Express St Mary'S | 3 | HREC0D512 (row 1294), HREC512 (row 1295), HREC950 (row 1296) |
| OK Supermarkets -Rezende | 3 | HREC0D508 (row 1297), HREC508 (row 1298), HREC951 (row 1299) |
| OK Supermarkets -Wayne Takeaway | 3 | HREC0D518 (row 1300), HREC518 (row 1301), HREC952 (row 1302) |
| OK ZIMBABWE SWELL ALLOWANCES | 2 | BYOC0D400 (row 1306), BYOC259 (row 1307) |
| OKB Chiredzi Byo | 2 | BYOC0D151 (row 1310), BYOC120 (row 1311) |
| OKB Gweru Byo | 2 | BYOC076 (row 1316), BYOC0D095 (row 1317) |
| OKB Mart Gweru Byo | 2 | BYOC0D152 (row 1327), BYOC121 (row 1328) |
| OKB Triangle Byo | 2 | BYOC0D153 (row 1337), BYOC122 (row 1338) |
| Olive Comfort | 2 | HREC0D649 (row 1343), HREC649 (row 1344) |
| Organizer Investments | 2 | HREC0D522 (row 1347), HREC522 (row 1348) |
| Oriel Boys High School | 2 | HREC0D523 (row 1349), HREC523 (row 1350) |
| Orphanage Home | 3 | HREC009 (row 1351), HREC0D09 (row 1352), HREC0D9 (row 1353) |
| P. S. Munyanyi [Diamond] | 2 | HREC0D554 (row 1355), HREC554 (row 1356) |
| Padenga Agribusiness | 2 | HREC0D524 (row 1360), HREC524 (row 1361) |
| Pamstead Fruit And Veg | 2 | HREC0D526 (row 1363), HREC526 (row 1364) |
| Panmart Mutare | 2 | HREC0D528 (row 1365), HREC528 (row 1366) |
| Panmart Rusape | 3 | HREC0D527 (row 1367), HREC527 (row 1368), HREC838 (row 1369) |
| Paramount Exports Pvt Ltd | 2 | HREC0D530 (row 1372), HREC530 (row 1373) |
| Pardon Takangovada Mr | 2 | HREC0D640 (row 1374), HREC640 (row 1375) |
| Parirenyatwa Group Of Hospitals | 2 | HREC0D532 (row 1376), HREC532 (row 1377) |
| Parkview Hospital | 2 | HREC0D534 (row 1378), HREC534 (row 1379) |
| Peter Tivaone (Staff Acc -Masvingo ) | 2 | HREC0D665 (row 1384), HREC665 (row 1385) |
| Peyn Fruit | 2 | HREC0D541 (row 1387), HREC541 (row 1388) |
| Pgs Produce | 2 | HREC0D542 (row 1389), HREC542 (row 1390) |
| Pick & Win Kuwadzana 2 | 2 | HREC0D543 (row 1394), HREC543 (row 1395) |
| Plaza Bakery -Kwekwe | 2 | HREC0D544 (row 1401), HREC544 (row 1402) |
| Plaza Food Chain Group | 2 | HREC0D176 (row 1403), HREC176 (row 1404) |
| Plum Vine | 2 | HREC0D545 (row 1405), HREC545 (row 1406) |
| Polshow Investments T/A Mercury Produce | 2 | HREC0D546 (row 1409), HREC546 (row 1410) |
| Premier Service Medical Investments | 2 | HREC0D553 (row 1417), HREC553 (row 1418) |
| Price Rite Norton | 2 | HREC0D549 (row 1419), HREC549 (row 1420) |
| Primrose -Steelforce | 2 | HREC0D634 (row 1421), HREC634 (row 1422) |
| Prince Danda(Offset A/Cc) | 2 | HREC0D548 (row 1423), HREC548 (row 1424) |
| Progress Chahuruva(Steelforce) | 2 | HREC0D550 (row 1425), HREC550 (row 1426) |
| Promet Projects Private Limited | 2 | HREC0D249 (row 1427), HREC249 (row 1428) |
| Promotions - Customers | 2 | BYOC0D172 (row 1429), HREC356 (row 1430) |
| Prosper Muchuchu | 2 | HREC0D551 (row 1440), HREC551 (row 1441) |
| Prycmart Supermarket | 2 | HREC0D552 (row 1443), HREC552 (row 1444) |
| Qondile | 2 | HREC036 (row 1445), HREC0D36 (row 1446) |
| Quad Kay Produce (Pvt) Ltd | 2 | HREC0D789 (row 1447), HREC789 (row 1448) |
| Radchart Supermarkets | 2 | HREC0D557 (row 1453), HREC557 (row 1454) |
| Rainbow Tourism Group Harare | 2 | HREC0D561 (row 1457), HREC561 (row 1458) |
| Rainbow Tourism Group Ltd - Kadoma | 2 | HREC0D579 (row 1459), HREC579 (row 1460) |
| Rainbow Tourism Group t/a Azambezi River Lodge | 2 | BYOC007 (row 1461), BYOC0D011 (row 1462) |
| Ram Balantyne | 2 | HREC0D565 (row 1464), HREC565 (row 1465) |
| Ram Banket | 2 | HREC0D558 (row 1466), HREC558 (row 1467) |
| Ram Head Office | 2 | HREC0D559 (row 1468), HREC559 (row 1469) |
| Ram Zengeza | 2 | HREC0D560 (row 1470), HREC560 (row 1471) |
| Raymond Alfred | 2 | HREC0D05 (row 1474), HREC0D5 (row 1475) |
| Raymond Madziw - Rsc Steelforce | 2 | HREC0D564 (row 1476), HREC564 (row 1477) |
| Renaste Investments T/A Mr Fresh | 4 | HREC0D567 (row 1483), HREC0D568 (row 1484), HREC567 (row 1485), HREC568 (row 1486) |
| Restan T/A Sav Marondera | 2 | HREC0D850 (row 1488), HREC850 (row 1489) |
| Rhodesville Spar | 2 | HREC0D570 (row 1492), HREC570 (row 1493) |
| Richard Tokora | 2 | HREC0D724 (row 1494), HREC724 (row 1495) |
| Riverton Academy | 2 | HREC0D571 (row 1496), HREC571 (row 1497) |
| Robin Dumba [Contra Account] | 2 | HREC0D574 (row 1498), HREC574 (row 1499) |
| Rokos Holdings | 2 | HREC0D575 (row 1502), HREC575 (row 1503) |
| Roosters Food Court | 2 | HREC0D576 (row 1504), HREC576 (row 1505) |
| Royal Eagle (Set-Off Acc) | 2 | HREC0D577 (row 1506), HREC577 (row 1507) |
| Royal Harare Golf Club | 2 | HREC0D569 (row 1508), HREC569 (row 1509) |
| Rsc Steelforce Pvt Ltd | 2 | HREC0D631 (row 1512), HREC631 (row 1513) |
| Rufaro Shisanyama | 2 | HREC0D581 (row 1542), HREC581 (row 1543) |
| Rumbidzai Dangare | 2 | HREC0D132 (row 1544), HREC132 (row 1545) |
| Runnar Chickens | 2 | HREC0D562 (row 1547), HREC562 (row 1548) |
| Ruwa Greens | 2 | HREC0D584 (row 1551), HREC584 (row 1552) |
| Rydings School | 2 | HREC0D586 (row 1553), HREC586 (row 1554) |
| S. Mavengere | 2 | HREC0D338 (row 1555), HREC338 (row 1556) |
| Sabina Muzuva (Set Off Acc) | 2 | HREC0D398 (row 1558), HREC398 (row 1559) |
| Sabre | 2 | HREC037 (row 1560), HREC0D37 (row 1561) |
| Sagenite Investments | 2 | HREC0D588 (row 1565), HREC588 (row 1566) |
| Sakubva Spar | 2 | HREC0D589 (row 1567), HREC589 (row 1568) |
| Sales Promotions | 2 | HREC0D590 (row 1569), HREC590 (row 1570) |
| Samro Farm | 2 | HREC0D593 (row 1571), HREC593 (row 1572) |
| Sarah | 2 | HREC038 (row 1573), HREC0D38 (row 1574) |
| Sav Wholesalers | 2 | HREC0D596 (row 1575), HREC596 (row 1576) |
| Savemore Westlea | 2 | HREC0D595 (row 1577), HREC595 (row 1578) |
| Sean Oliphant Mr | 2 | HREC0D520 (row 1579), HREC520 (row 1580) |
| Selby Enterprises Pvt Ltd | 2 | HREC0D598 (row 1582), HREC598 (row 1583) |
| Selina | 2 | HREC039 (row 1584), HREC0D39 (row 1585) |
| Servcor | 2 | HREC0D638 (row 1586), HREC638 (row 1587) |
| Shiriyedenga(Set Off Account) | 2 | HREC0D603 (row 1593), HREC603 (row 1594) |
| Skyclare Ent. T/A Spar Market Square | 2 | HREC0D319 (row 1605), HREC319 (row 1606) |
| Slice Distributors (Pvt) Ltd | 2 | HREC081 (row 1607), HREC0D81 (row 1608) |
| Sonja On The Deck Complex | 2 | HREC0D843 (row 1612), HREC843 (row 1613) |
| Spar Arcadia | 2 | HREC0D614 (row 1615), HREC614 (row 1616) |
| Spar Ballantyne | 2 | HREC024 (row 1618), HREC0D24 (row 1619) |
| Spar Borrowdale Village | 2 | HREC0D626 (row 1620), HREC626 (row 1621) |
| Spar Braeside | 2 | HREC0D608 (row 1622), HREC608 (row 1623) |
| Spar Bridge | 2 | HREC0D615 (row 1624), HREC615 (row 1625) |
| Spar Chivhu | 2 | HREC0D616 (row 1626), HREC616 (row 1627) |
| Spar Golden Stairs | 2 | HREC0D617 (row 1628), HREC617 (row 1629) |
| Spar Greencroft | 2 | HREC0D954 (row 1630), HREC953 (row 1631) |
| Spar Groombridge | 2 | HREC0D627 (row 1632), HREC627 (row 1633) |
| Spar Helensvale | 2 | HREC0D618 (row 1634), HREC618 (row 1635) |
| Spar Kadoma | 2 | HREC0D620 (row 1638), HREC620 (row 1639) |
| Spar Kamfinsa | 2 | HREC0D610 (row 1640), HREC610 (row 1641) |
| Spar Kwekwe | 2 | HREC0D611 (row 1642), HREC611 (row 1643) |
| Spar Mabelreign | 2 | HREC0D612 (row 1644), HREC612 (row 1645) |
| Spar Marondera | 2 | HREC0D621 (row 1646), HREC621 (row 1647) |
| Spar Megasave Letombo | 2 | HREC0D276 (row 1648), HREC276 (row 1649) |
| Spar Midlands Gweru | 2 | HREC0D622 (row 1650), HREC622 (row 1651) |
| Spar Montague | 2 | HREC0D623 (row 1652), HREC623 (row 1653) |
| Spar Mufakose | 2 | HREC0D613 (row 1654), HREC613 (row 1655) |
| Spar Mutare | 2 | HREC0D628 (row 1656), HREC628 (row 1657) |
| Spar Mvuma | 2 | HREC0D624 (row 1658), HREC624 (row 1659) |
| Spar Queensdale | 4 | HREC0D555 (row 1660), HREC0D625 (row 1661), HREC555 (row 1662), HREC625 (row 1663) |
| St Annes Hospital T/A Mary Mother F Hope | 2 | HREC0D630 (row 1667), HREC630 (row 1668) |
| Staff Account - Action Dingo | 2 | HREC0D141 (row 1674), HREC141 (row 1675) |
| Staff Account - Admire Chinyerere | 3 | HREC0D03 (row 1676), HREC0D3 (row 1677), HRESTAFF01 (row 1678) |
| Staff Account - Agatha Zhou | 2 | HREC0D774 (row 1680), HREC774 (row 1681) |
| Staff Account - Alex Elliot | 2 | HREC0D164 (row 1682), HREC164 (row 1683) |
| Staff Account - Alexio Chinguwa | 2 | HREC089 (row 1684), HREC0D89 (row 1685) |
| Staff Account - Alexio Masarakufa | 2 | HREC0D324 (row 1686), HREC324 (row 1687) |
| Staff Account - Alice Jacob | 3 | HREC006 (row 1688), HREC0D06 (row 1689), HREC0D6 (row 1690) |
| Staff Account - Angeline Chipwanya | 2 | HREC075 (row 1694), HREC0D75 (row 1695) |
| Staff Account - Ashley Nyaundi | 2 | HREC0D420 (row 1697), HREC420 (row 1698) |
| Staff Account - Ashton Makunda | 2 | HREC016 (row 1699), HREC0D16 (row 1700) |
| Staff Account - Assan Muyengwa | 2 | HREC0D394 (row 1701), HREC394 (row 1702) |
| Staff Account - Benjamin Musarurwa | 2 | HREC045 (row 1706), HREC0D45 (row 1707) |
| Staff Account - Benjamin Sabulalo | 2 | HREC0D587 (row 1708), HREC587 (row 1709) |
| Staff Account - Blessed Faith Mapfumo | 2 | HREC0D316 (row 1713), HREC316 (row 1714) |
| Staff Account - Brendon Munashe Majuru | 2 | HREC0D297 (row 1715), HREC297 (row 1716) |
| Staff Account - Brendon Mutowa | 2 | HREC0D389 (row 1717), HREC389 (row 1718) |
| Staff Account - Brian Mahachi | 2 | HREC0D293 (row 1719), HREC293 (row 1720) |
| Staff Account - Bright Chisanho | 2 | HREC095 (row 1721), HREC0D95 (row 1722) |
| Staff Account - Brighton Jim | 2 | HREC048 (row 1723), HREC0D48 (row 1724) |
| Staff Account - Brilliant Masuka | 2 | HREC0D330 (row 1725), HREC330 (row 1726) |
| Staff Account - Brilton Macharaga | 2 | HREC053 (row 1727), HREC0D53 (row 1728) |
| Staff Account - Brinden Nyakudanga | 2 | HREC0D415 (row 1729), HREC415 (row 1730) |
| Staff Account - Cathrine Nhokwara | 2 | HREC0D410 (row 1731), HREC410 (row 1732) |
| Staff Account - Chabvepi Sheldon | 2 | HREC068 (row 1734), HREC0D68 (row 1735) |
| Staff Account - Chalton Kawanza | 2 | HREC0D262 (row 1736), HREC262 (row 1737) |
| Staff Account - Charity Jakarasi | 2 | HREC0D239 (row 1739), HREC239 (row 1740) |
| Staff Account - Chitaitai Clophas | 2 | HREC097 (row 1742), HREC0D97 (row 1743) |
| Staff Account - Clemence  T Dongo | 2 | HREC0D146 (row 1747), HREC146 (row 1748) |
| Staff Account - Clement Ngirazi | 2 | HREC0D407 (row 1749), HREC407 (row 1750) |
| Staff Account - Clive Chibanda | 2 | HREC0D115 (row 1752), HREC115 (row 1753) |
| Staff Account - Clive Makunda | 2 | HREC0D303 (row 1754), HREC303 (row 1755) |
| Staff Account - Cloudius Muyengwa | 2 | HREC0D395 (row 1756), HREC395 (row 1757) |
| Staff Account - Confidence Mhene | 2 | HREC0D345 (row 1760), HREC345 (row 1761) |
| Staff Account - Courage Munzwa | 2 | HREC0D377 (row 1763), HREC377 (row 1764) |
| Staff Account - Courage Mzenda | 2 | HREC0D121 (row 1765), HREC121 (row 1766) |
| Staff Account - Daniel Padzamuka | 2 | HREC0D525 (row 1768), HREC525 (row 1769) |
| Staff Account - Dannis Girijoni | 2 | HREC0D199 (row 1770), HREC199 (row 1771) |
| Staff Account - Deploy Mhere | 2 | HREC0D346 (row 1774), HREC346 (row 1775) |
| Staff Account - Donemore Nyahodza | 2 | HREC0D143 (row 1776), HREC143 (row 1777) |
| Staff Account - Dyariwa Alexander | 2 | HREC0D148 (row 1779), HREC148 (row 1780) |
| Staff Account - Ebson Makichi | 2 | HREC0D299 (row 1781), HREC299 (row 1782) |
| Staff Account - Echo Chepi | 2 | HREC077 (row 1783), HREC0D77 (row 1784) |
| Staff Account - Edmore Chitiyo | 2 | HREC098 (row 1785), HREC0D98 (row 1786) |
| Staff Account - Edward Chidavaenzi | 2 | HREC083 (row 1787), HREC0D83 (row 1788) |
| Staff Account - Edwin Bema | 2 | HREC044 (row 1789), HREC0D44 (row 1790) |
| Staff Account - Elias Mukaro | 2 | HREC0D797 (row 1791), HREC797 (row 1792) |
| Staff Account - Elvis Muzenda | 2 | HREC0D397 (row 1793), HREC397 (row 1794) |
| Staff Account - Engson Ushe | 2 | HREC0D741 (row 1796), HREC741 (row 1797) |
| Staff Account - Enock Caleb Nhau | 2 | HREC0D408 (row 1798), HREC408 (row 1799) |
| Staff Account - Enock Mora | 2 | HREC0D354 (row 1800), HREC354 (row 1801) |
| Staff Account - Ephraime Chasumba | 2 | HREC278 (row 1802), HRESTAFF015 (row 1803) |
| Staff Account - Esnath Muchimika | 2 | HREC0D362 (row 1805), HREC362 (row 1806) |
| Staff Account - Esther Nyangu | 2 | HREC0D168 (row 1807), HREC168 (row 1808) |
| Staff Account - Evidence Marumahoko | 2 | HREC0D323 (row 1809), HREC323 (row 1810) |
| Staff Account - Faith Chibanda | 2 | HREC078 (row 1811), HREC0D78 (row 1812) |
| Staff Account - Faith Rudo Dongo | 2 | HREC0D580 (row 1813), HREC580 (row 1814) |
| Staff Account - Fanuel Manuel | 2 | HREC0D305 (row 1815), HREC305 (row 1816) |
| Staff Account - Farai Hakutizwi | 2 | HREC0D215 (row 1818), HREC215 (row 1819) |
| Staff Account - Fungai Mutsvene | 2 | HREC0D391 (row 1820), HREC391 (row 1821) |
| Staff Account - Garikai Mutadzi | 2 | HREC0D202 (row 1822), HREC202 (row 1823) |
| Staff Account - Given Mbanga | 2 | HREC0D339 (row 1826), HREC339 (row 1827) |
| Staff Account - Godwish Juwao | 2 | HREC0D251 (row 1829), HREC251 (row 1830) |
| Staff Account - Gwande Danai | 2 | HREC0D211 (row 1831), HREC211 (row 1832) |
| Staff Account - Hesman Maguroto | 2 | HREC0D291 (row 1833), HREC291 (row 1834) |
| Staff Account - Howard Chimhangwa | 2 | HREC088 (row 1836), HREC0D88 (row 1837) |
| Staff Account - Innocent Tarwirei | 2 | HREC0D650 (row 1838), HREC650 (row 1839) |
| Staff Account - Irvine Chimanya | 2 | HREC087 (row 1840), HREC0D87 (row 1841) |
| Staff Account - Jacuos Chigudu | 2 | HREC0D238 (row 1843), HREC238 (row 1844) |
| Staff Account - Jephita Mukumbi | 2 | HREC0D369 (row 1847), HREC369 (row 1848) |
| Staff Account - Jeremiah Nyabute | 2 | HREC0D414 (row 1850), HREC414 (row 1851) |
| Staff Account - Jimmy Karambira | 2 | HREC333 (row 1852), HREC798 (row 1853) |
| Staff Account - Jodias Matingo | 2 | HREC0D245 (row 1855), HREC245 (row 1856) |
| Staff Account - Joseph Matinhima | 2 | HREC0D334 (row 1860), HREC334 (row 1861) |
| Staff Account - Joyce Dube | 2 | HREC0D248 (row 1864), HREC248 (row 1865) |
| Staff Account - Julius Mudzingwa | 2 | HREC0D364 (row 1866), HREC364 (row 1867) |
| Staff Account - Justine Jim | 2 | HREC0D243 (row 1868), HREC243 (row 1869) |
| Staff Account - Kanditi Marshall | 2 | HREC0D255 (row 1870), HREC255 (row 1871) |
| Staff Account - Kelvin Katerere | 2 | HREC0D263 (row 1872), HREC263 (row 1873) |
| Staff Account - Kenneth Chipo | 2 | HREC093 (row 1875), HREC0D93 (row 1876) |
| Staff Account - Khumbulani Lawrence Moyo | 2 | HREC0D358 (row 1877), HREC358 (row 1878) |
| Staff Account - Knowledge Nyakutumba | 2 | HREC0D265 (row 1879), HREC265 (row 1880) |
| Staff Account - Kuchukuma Jairos | 2 | HREC0D267 (row 1881), HREC267 (row 1882) |
| Staff Account - Kudakwashe Chikwira | 2 | HREC086 (row 1883), HREC0D86 (row 1884) |
| Staff Account - Kudakwashe Mufaranechisi | 2 | BYOSTAFF26 (row 1886), BYOSTAFF67 (row 1887) |
| Staff Account - Langton Masimbi | 2 | HREC0D328 (row 1889), HREC328 (row 1890) |
| Staff Account - Lawrence Moyo | 2 | HREC0D359 (row 1891), HREC359 (row 1892) |
| Staff Account - Lawrence Zigari | 2 | HREC0D776 (row 1893), HREC776 (row 1894) |
| Staff Account - Learnmore Chibanda | 2 | HREC079 (row 1895), HREC0D79 (row 1896) |
| Staff Account - Liberty Makanga | 2 | HREC0D277 (row 1897), HREC277 (row 1898) |
| Staff Account - Lloyd Chitiga | 2 | HREC099 (row 1899), HREC0D99 (row 1900) |
| Staff Account - Lloyd Gurupira | 2 | HREC0D208 (row 1901), HREC208 (row 1902) |
| Staff Account - Lucky Kadongolo | 2 | HREC0D253 (row 1904), HREC253 (row 1905) |
| Staff Account - Luckymore Bande | 2 | HREC041 (row 1906), HREC0D41 (row 1907) |
| Staff Account - Mahove Blessing | 2 | HREC0D295 (row 1908), HREC295 (row 1909) |
| Staff Account - Makenzi Nihape | 2 | HREC0D351 (row 1910), HREC351 (row 1911) |
| Staff Account - Marlon Tinotenda Shamuyarira | 2 | HREC0D600 (row 1913), HREC600 (row 1914) |
| Staff Account - Martin Dzoma | 2 | HREC0D150 (row 1915), HREC150 (row 1916) |
| Staff Account - Mary Makumire | 2 | HREC0D302 (row 1917), HREC302 (row 1918) |
| Staff Account - Mary Muhwati | 2 | HREC0D368 (row 1919), HREC368 (row 1920) |
| Staff Account - Matinhima Joseph | 2 | HREC0D331 (row 1921), HREC331 (row 1922) |
| Staff Account - Misheck Musarurwa | 2 | HREC0D349 (row 1925), HREC349 (row 1926) |
| Staff Account - Moreeffort Mutumiri | 2 | HREC0D392 (row 1927), HREC392 (row 1928) |
| Staff Account - Mr Williams | 2 | HREC0D763 (row 1930), HREC763 (row 1931) |
| Staff Account - Mufuka Jairos | 2 | HREC0D365 (row 1933), HREC365 (row 1934) |
| Staff Account - Mukarakate Taurai | 2 | HREC0D370 (row 1935), HREC370 (row 1936) |
| Staff Account - Munyaradzi Drawu | 2 | HREC0D376 (row 1937), HREC376 (row 1938) |
| Staff Account - Munyaradzi Gutsa | 2 | HREC0D209 (row 1939), HREC209 (row 1940) |
| Staff Account - Mutadzi Taurai | 2 | HREC0D386 (row 1943), HREC386 (row 1944) |
| Staff Account - Mutanga Pemberai | 2 | HREC0D539 (row 1945), HREC539 (row 1946) |
| Staff Account - Mutema Gerald F | 2 | HREC0D385 (row 1947), HREC385 (row 1948) |
| Staff Account - Nemapari Terrence | 2 | HREC0D404 (row 1950), HREC404 (row 1951) |
| Staff Account - Ngonidzaishe M Mutindi | 2 | HREC0D388 (row 1952), HREC388 (row 1953) |
| Staff Account - Ngonidzashe Rwodzi | 2 | HREC0D585 (row 1954), HREC585 (row 1955) |
| Staff Account - Nihape Mackenzie | 2 | HREC0D286 (row 1957), HREC286 (row 1958) |
| Staff Account - Nomater Dziva | 2 | HREC0D149 (row 1961), HREC149 (row 1962) |
| Staff Account - Nomore Chikoko | 2 | HREC0D226 (row 1963), HREC226 (row 1964) |
| Staff Account - Norest Munemo | 2 | HREC0D413 (row 1966), HREC413 (row 1967) |
| Staff Account - Nqobizitha Rusere | 2 | HREC0D583 (row 1968), HREC583 (row 1969) |
| Staff Account - Nyamusona Godknows | 2 | HREC0D416 (row 1970), HREC416 (row 1971) |
| Staff Account - Oscar Zaranyika | 2 | HREC0D773 (row 1978), HREC773 (row 1979) |
| Staff Account - Oswald Zimuto | 2 | HREC0D779 (row 1980), HREC779 (row 1981) |
| Staff Account - Owen Samhokore | 2 | HREC0D591 (row 1982), HREC591 (row 1983) |
| Staff Account - Ozwell Makunda | 2 | HREC0D304 (row 1984), HREC304 (row 1985) |
| Staff Account - P. Nzununu | 2 | HREC0D151 (row 1986), HREC151 (row 1987) |
| Staff Account - Pardington Mubaiwa | 2 | HREC0D531 (row 1988), HREC531 (row 1989) |
| Staff Account - Patson Chapfudza | 2 | HREC0D535 (row 1992), HREC535 (row 1993) |
| Staff Account - Patson Nzunuwu | 2 | HREC0D537 (row 1994), HREC537 (row 1995) |
| Staff Account - Patson Tamanikwa | 2 | HREC0D536 (row 1996), HREC536 (row 1997) |
| Staff Account - Pedzisai Maguma | 2 | HREC0D538 (row 1998), HREC538 (row 1999) |
| Staff Account - Peter Foya | 2 | HREC0D247 (row 2000), HREC247 (row 2001) |
| Staff Account - Prisca Matonhodze | 2 | HREC0D547 (row 2009), HREC547 (row 2010) |
| Staff Account - Proud Mwakaliha | 2 | HREC0D399 (row 2011), HREC399 (row 2012) |
| Staff Account - Rabecca Gondodza | 2 | HREC0D204 (row 2013), HREC204 (row 2014) |
| Staff Account - Rachel R Kundishora | 2 | HREC0D271 (row 2015), HREC271 (row 2016) |
| Staff Account - Rachel Tangawabaiwa | 2 | HREC0D556 (row 2017), HREC556 (row 2018) |
| Staff Account - Regina Kaitano | 2 | HREC0D566 (row 2020), HREC566 (row 2021) |
| Staff Account - Reward Kudyanyemba | 2 | HREC0D269 (row 2022), HREC269 (row 2023) |
| Staff Account - Richard Makuvaza | 2 | HREC0D301 (row 2024), HREC301 (row 2025) |
| Staff Account - Richard Mutimwa | 2 | HREC0D387 (row 2026), HREC387 (row 2027) |
| Staff Account - Rumbidzai Chambwe | 2 | HREC073 (row 2030), HREC0D73 (row 2031) |
| Staff Account - Rutendo Teya | 2 | HREC0D661 (row 2032), HREC661 (row 2033) |
| Staff Account - Samson Mashafunga | 2 | HREC0D325 (row 2037), HREC325 (row 2038) |
| Staff Account - Samuel J Magirini | 2 | HREC0D288 (row 2039), HREC288 (row 2040) |
| Staff Account - Samuel Magirini | 2 | HREC0D290 (row 2041), HREC290 (row 2042) |
| Staff Account - Sean G Mukondi Marange | 2 | HREC0D317 (row 2043), HREC317 (row 2044) |
| Staff Account - Seawell Muwoni | 2 | HREC0D597 (row 2045), HREC597 (row 2046) |
| Staff Account - Seldom Chabvepi | 2 | HREC067 (row 2047), HREC0D67 (row 2048) |
| Staff Account - Sheldon Chaibvepi | 2 | HREC070 (row 2052), HREC0D70 (row 2053) |
| Staff Account - Shingirai Maphosa | 2 | HREC0D232 (row 2054), HREC232 (row 2055) |
| Staff Account - Shirleen Zinyama | 2 | HREC0D781 (row 2056), HREC781 (row 2057) |
| Staff Account - Simba Wurayai | 2 | HREC0D767 (row 2060), HREC767 (row 2061) |
| Staff Account - Simbarashe Mandivengerei | 2 | HREC0D308 (row 2062), HREC308 (row 2063) |
| Staff Account - Simbarashe Mbvungutsi | 2 | HREC0D341 (row 2064), HREC341 (row 2065) |
| Staff Account - Simbarashe Mugadza | 2 | HREC0D366 (row 2066), HREC366 (row 2067) |
| Staff Account - Simbarashe Zuva | 2 | HREC0D604 (row 2068), HREC604 (row 2069) |
| Staff Account - Sonny Lapukeni | 2 | HREC0D274 (row 2071), HREC274 (row 2072) |
| Staff Account - Spencer Sumani | 2 | HREC0D635 (row 2073), HREC635 (row 2074) |
| Staff Account - Steve Shirto | 2 | HREC0D632 (row 2075), HREC632 (row 2076) |
| Staff Account - Sumburani Blessing | 2 | HREC0D636 (row 2077), HREC636 (row 2078) |
| Staff Account - Tafadzwa Jacob | 2 | HREC0D236 (row 2082), HREC236 (row 2083) |
| Staff Account - Tafadzwa Kundeni | 2 | HREC0D639 (row 2085), HREC639 (row 2086) |
| Staff Account - Tafadzwa Muponda | 2 | HREC0D379 (row 2087), HREC379 (row 2088) |
| Staff Account - Tafanana | 2 | HREC0D133 (row 2089), HREC133 (row 2090) |
| Staff Account - Takudzwa Jacob | 2 | HREC0D237 (row 2091), HREC237 (row 2092) |
| Staff Account - Takudzwa Kateya | 2 | HREC0D260 (row 2093), HREC260 (row 2094) |
| Staff Account - Talent F Nyamangodo | 2 | HREC0D417 (row 2095), HREC417 (row 2096) |
| Staff Account - Talent M Shinya | 2 | HREC0D602 (row 2097), HREC602 (row 2098) |
| Staff Account - Talent Tevedzanai | 2 | HREC0D660 (row 2099), HREC660 (row 2100) |
| Staff Account - Tambudzai M .Mashavira | 2 | HREC0D326 (row 2101), HREC326 (row 2102) |
| Staff Account - Tambudzai Mupfumisi | 2 | HREC0D645 (row 2103), HREC645 (row 2104) |
| Staff Account - Tanaka Takadiyi | 2 | HREC0D641 (row 2105), HREC641 (row 2106) |
| Staff Account - Tapiwa Matamba | 2 | HREC0D648 (row 2107), HREC648 (row 2108) |
| Staff Account - Tapiwa Runzonza | 2 | HREC0D582 (row 2109), HREC582 (row 2110) |
| Staff Account - Taseka Kanomanyanga | 2 | HREC0D256 (row 2113), HREC256 (row 2114) |
| Staff Account - Tatenda Manyawi | 2 | HREC0D314 (row 2115), HREC314 (row 2116) |
| Staff Account - Tatenda Maruza | 2 | HREC0D322 (row 2117), HREC322 (row 2118) |
| Staff Account - Tatenda Matonhodze | 2 | HREC0D336 (row 2119), HREC336 (row 2120) |
| Staff Account - Tatenda Willbrod Mutsure | 2 | HREC0D390 (row 2121), HREC390 (row 2122) |
| Staff Account - Tatenda Zvegona | 2 | HREC0D786 (row 2123), HREC786 (row 2124) |
| Staff Account - Taurai Sixpence | 2 | HREC0D221 (row 2125), HREC221 (row 2126) |
| Staff Account - Tavaziva Mukuze | 2 | HREC0D654 (row 2127), HREC654 (row 2128) |
| Staff Account - Tawanda Mandivengerei | 2 | HREC0D656 (row 2130), HREC656 (row 2131) |
| Staff Account - Tawanda Matamba | 2 | HREC0D655 (row 2132), HREC655 (row 2133) |
| Staff Account - Teddy Madholo | 2 | HREC0D658 (row 2136), HREC658 (row 2137) |
| Staff Account - Tendai Marowa | 2 | HREC0D321 (row 2139), HREC321 (row 2140) |
| Staff Account - Tendayi Gomora | 2 | HREC0D203 (row 2141), HREC203 (row 2142) |
| Staff Account - Thandeka | 2 | HREC0D662 (row 2144), HREC662 (row 2145) |
| Staff Account - Tinashe Muripe | 2 | HREC0D380 (row 2149), HREC380 (row 2150) |
| Staff Account - Tinashe Musarurwa | 2 | HREC0D382 (row 2151), HREC382 (row 2152) |
| Staff Account - Titos Mupesi | 2 | HREC0D378 (row 2155), HREC378 (row 2156) |
| Staff Account - Togarasei Muyengwa | 2 | HREC0D723 (row 2158), HREC723 (row 2159) |
| Staff Account - Tonderai Shamba | 2 | HREC0D599 (row 2160), HREC599 (row 2161) |
| Staff Account - Tsitsi Mhembere | 2 | HREC0D344 (row 2162), HREC344 (row 2163) |
| Staff Account - Vimbai Sambo | 2 | HREC0D592 (row 2165), HREC592 (row 2166) |
| Staff Account - Vuso Zaba | 2 | HREC0D769 (row 2170), HREC769 (row 2171) |
| Staff Account - Wellington Takadiyi | 2 | HREC0D642 (row 2173), HREC642 (row 2174) |
| Staff Account - Wilbar Majuri | 2 | HREC0D212 (row 2175), HREC212 (row 2176) |
| Staff Account - William Takunda | 2 | HREC0D643 (row 2178), HREC643 (row 2179) |
| Staff Account - Zimbulani Noah | 2 | HREC0D778 (row 2180), HREC778 (row 2181) |
| Staff Account - Zinyama Kudakwashe | 2 | HREC0D780 (row 2182), HREC780 (row 2183) |
| Staff Canteen | 4 | HREC060 (row 2190), HREC0D60 (row 2191), HREC0D629 (row 2192), HREC629 (row 2193) |
| Steamleigh Invest. T/A Healthpoint Hospital | 2 | HREC0D337 (row 2199), HREC337 (row 2200) |
| Stort Fort -Mabelreign | 2 | HREC0D633 (row 2202), HREC633 (row 2203) |
| Sunset Marketing | 2 | BYOC0D211 (row 2206), BYOC179 (row 2207) |
| Sunspun Bananas | 2 | HREC0D637 (row 2208), HREC637 (row 2209) |
| Talwant Trading T/A Fruit And Veg Borrow | 2 | HREC0D644 (row 2217), HREC644 (row 2218) |
| Tammy_Lilfordia School_Cod | 2 | HREC0D646 (row 2221), HREC646 (row 2222) |
| Tanyaradzwa Mandipira | 2 | HREC0D647 (row 2227), HREC647 (row 2228) |
| Tapiwa Muguti ( Set Off Acc ) | 2 | HREC0D367 (row 2229), HREC367 (row 2230) |
| Tawanda Yonasi | 2 | HREC0D768 (row 2234), HREC768 (row 2235) |
| Tc Tuckshop -Rimuka | 2 | HREC0D657 (row 2237), HREC657 (row 2238) |
| Tendai Produce | 2 | HREC0D659 (row 2242), HREC659 (row 2243) |
| Tendai Trish Mugurungi | 2 | HREC0D846 (row 2244), HREC846 (row 2245) |
| The Village - Borrowdale | 2 | HREC0D529 (row 2255), HREC529 (row 2256) |
| The Village Lodge | 2 | HREC0D606 (row 2257), HREC606 (row 2258) |
| Tinashe_Cod_Tm Kadoma | 2 | HREC0D663 (row 2263), HREC663 (row 2264) |
| Tinkerbell | 2 | HREC0D664 (row 2265), HREC664 (row 2266) |
| TM Supermarket (Pvt) Ltd  - Orr Street | 2 | HREC705 (row 2273), HREC819 (row 2274) |
| TM Supermarkets (Pvt) Ltd  - Aspindale | 2 | HREC729 (row 2282), HREC830 (row 2283) |
| TM Supermarkets (Pvt) Ltd  - Chegutu | 3 | HREC0D673 (row 2291), HREC673 (row 2292), HREC803 (row 2293) |
| TM Supermarkets (Pvt) Ltd  - Chinhoyi North | 2 | HREC677 (row 2294), HREC805 (row 2295) |
| TM Supermarkets (Pvt) Ltd  - Gwanda Zig | 2 | BYOC134 (row 2304), BYOC135 (row 2305) |
| TM Supermarkets (Pvt) Ltd  - Harare Street | 3 | HREC0D683 (row 2308), HREC683 (row 2309), HREC808 (row 2310) |
| TM Supermarkets (Pvt) Ltd  - Highlands Park | 2 | HREC727 (row 2311), HREC828 (row 2312) |
| TM Supermarkets (Pvt) Ltd  - Hogerty Hills | 2 | HREC0D841 (row 2313), HREC841 (row 2314) |
| TM Supermarkets (Pvt) Ltd  - Kamfinsa | 2 | HREC733 (row 2320), HREC832 (row 2321) |
| TM Supermarkets (Pvt) Ltd  - Karoi | 3 | HREC690 (row 2323), HREC811 (row 2324), HREC836 (row 2325) |
| TM Supermarkets (Pvt) Ltd  - Madokero | 3 | HREC0D726 (row 2329), HREC726 (row 2330), HREC827 (row 2331) |
| TM Supermarkets (Pvt) Ltd  - Msasa | 2 | HREC699 (row 2336), HREC814 (row 2337) |
| TM Supermarkets (Pvt) Ltd  - Mutare | 3 | HREC0D701 (row 2338), HREC701 (row 2339), HREC816 (row 2340) |
| TM Supermarkets (Pvt) Ltd  - Mutoko | 2 | HREC700 (row 2341), HREC815 (row 2342) |
| TM Supermarkets (Pvt) Ltd  - Newlands | 3 | HREC0D702 (row 2343), HREC702 (row 2344), HREC817 (row 2345) |
| TM Supermarkets (Pvt) Ltd  - Northend | 2 | HREC0D704 (row 2346), HREC704 (row 2347) |
| TM Supermarkets (Pvt) Ltd  - Norton | 3 | HREC0D703 (row 2349), HREC703 (row 2350), HREC818 (row 2351) |
| TM Supermarkets (Pvt) Ltd  - Rusape | 3 | HREC0D711 (row 2353), HREC711 (row 2354), HREC822 (row 2355) |
| TM Supermarkets (Pvt) Ltd  - Shurugwi | 4 | BYOC0D274 (row 2357), BYOC274 (row 2358), HREC0D958 (row 2359), HREC958 (row 2360) |
| TM Supermarkets (Pvt) Ltd  - Simon Mazorodze | 3 | HREC0D736 (row 2361), HREC736 (row 2362), HREC835 (row 2363) |
| TM Supermarkets (Pvt) Ltd  -Arundel | 3 | HREC0D728 (row 2369), HREC728 (row 2370), HREC829 (row 2371) |
| TM Supermarkets (Pvt) Ltd  -Marondera Main | 3 | HREC0D698 (row 2378), HREC698 (row 2379), HREC813 (row 2380) |
| TM Supermarkets (Pvt) Ltd  -Sakubva Mutare | 3 | HREC0D713 (row 2382), HREC713 (row 2383), HREC824 (row 2384) |
| TM Supermarkets (Pvt) Ltd  -Westgate | 3 | HREC0D735 (row 2385), HREC735 (row 2386), HREC834 (row 2387) |
| TM Supermarkets (Pvt) Ltd  Karoi T/Away | 2 | HREC0D714 (row 2388), HREC714 (row 2389) |
| TM Supermarkets (Pvt) Ltd -  Kwekwe | 2 | HREC0D691 (row 2392), HREC691 (row 2393) |
| TM Supermarkets (Pvt) Ltd - Avondale | 3 | HREC0D668 (row 2397), HREC668 (row 2398), HREC801 (row 2399) |
| TM Supermarkets (Pvt) Ltd - Chadcombe | 2 | HREC0D672 (row 2402), HREC672 (row 2403) |
| TM Supermarkets (Pvt) Ltd - Chinhoyi South | 3 | HREC0D679 (row 2405), HREC679 (row 2406), HREC807 (row 2407) |
| TM Supermarkets (Pvt) Ltd - Chipinge | 2 | HREC675 (row 2408), HREC804 (row 2409) |
| TM Supermarkets (Pvt) Ltd - Chiremba | 3 | HREC0D678 (row 2411), HREC678 (row 2412), HREC806 (row 2413) |
| TM Supermarkets (Pvt) Ltd - Chivhu | 2 | HREC731 (row 2414), HREC831 (row 2415) |
| TM Supermarkets (Pvt) Ltd - Gweru | 2 | HREC0D682 (row 2419), HREC682 (row 2420) |
| TM Supermarkets (Pvt) Ltd - Kadoma | 2 | HREC686 (row 2425), HREC809 (row 2426) |
| TM Supermarkets (Pvt) Ltd - Kariba | 2 | HREC687 (row 2427), HREC810 (row 2428) |
| TM Supermarkets (Pvt) Ltd - Megawatt Gweru | 2 | HREC708 (row 2438), HREC821 (row 2439) |
| TM Supermarkets (Pvt) Ltd - Ruwa | 2 | HREC712 (row 2444), HREC823 (row 2445) |
| TM Supermarkets (Pvt) Ltd - Sam Nujoma | 2 | HREC734 (row 2446), HREC833 (row 2447) |
| TM Supermarkets (Pvt) Ltd - Strathaven | 3 | HREC0D716 (row 2449), HREC716 (row 2450), HREC825 (row 2451) |
| TM Supermarkets (Pvt) Ltd - Zengeza | 3 | HREC0D720 (row 2455), HREC720 (row 2456), HREC826 (row 2457) |
| TM Supermarkets (Pvt) Ltd -Joina City | 3 | HREC0D707 (row 2462), HREC707 (row 2463), HREC820 (row 2464) |
| TM Supermarkets (Pvt) Ltd -Makoni Takeaway | 3 | HREC0D696 (row 2466), HREC696 (row 2467), HREC812 (row 2468) |
| TM Supermarkets (Pvt) Ltd- Borrowdale | 3 | HREC0D671 (row 2475), HREC671 (row 2476), HREC802 (row 2477) |
| Tn Harlequin T/A Mart Grill | 2 | HREC0D216 (row 2480), HREC216 (row 2481) |
| Tn Harlequin T/A Tn Mart Kuwadzana | 2 | HREC0D217 (row 2482), HREC217 (row 2483) |
| Tn Harlequin T/A Tn Mart R. Mugabe | 2 | HREC0D218 (row 2484), HREC218 (row 2485) |
| Townsend Girls High -Carnegie Hostel | 2 | BYOC049 (row 2486), BYOC0D053 (row 2487) |
| Treger Metal | 2 | HREC0D737 (row 2494), HREC737 (row 2495) |
| Trymore Damson (Sett Off Acc ) | 2 | HREC0D131 (row 2500), HREC131 (row 2501) |
| Tsitsi Mushure | 2 | HREC0D383 (row 2509), HREC383 (row 2510) |
| Unclaimed Deposits | 2 | HREC0D738 (row 2512), HREC738 (row 2513) |
| University Of Zimbabwe | 2 | HREC0D739 (row 2517), HREC739 (row 2518) |
| Usd Cash Customer HRE | 2 | HREC0D740 (row 2519), HREC740 (row 2520) |
| Valley Farm Gweru | 2 | HREC0D744 (row 2523), HREC744 (row 2524) |
| Valley Farm Secrets - Harare T/A Edinnov | 3 | HREC0D742 (row 2527), HREC742 (row 2528), HREC848 (row 2529) |
| Valley Fresh | 2 | HREC0D743 (row 2530), HREC743 (row 2531) |
| Valley Mart Investments(Set-Off Acc) | 2 | HREC0D745 (row 2532), HREC745 (row 2533) |
| Van Sales | 2 | HREC0D746 (row 2536), HREC746 (row 2537) |
| Veg N' Veg | 2 | HREC0D748 (row 2539), HREC748 (row 2540) |
| Verify Engineering | 2 | HREC0D963 (row 2542), HREC963 (row 2543) |
| Villa Musika | 2 | HREC0D752 (row 2551), HREC752 (row 2552) |
| Village Greek Restaurant | 2 | HREC0D751 (row 2553), HREC751 (row 2554) |
| Viraj Parbhoo - Rsc Steelforce | 2 | HREC0D754 (row 2555), HREC754 (row 2556) |
| Virgin Veggies | 2 | HREC0D755 (row 2557), HREC755 (row 2558) |
| VIVA MARKETING | 2 | BYOCOD273 (row 2559), WFMSCOD124 (row 2560) |
| Vongai Mandudzo ( Set Off Acc ) | 2 | HREC0D309 (row 2561), HREC309 (row 2562) |
| Vumba Fresh Trading (Pvt ) Ltd | 2 | HREC0D756 (row 2563), HREC756 (row 2564) |
| Warehouse Waste | 2 | HREC0D758 (row 2567), HREC758 (row 2568) |
| Watershade College | 2 | HREC0D759 (row 2571), HREC759 (row 2572) |
| Watungwa A (Set Off Acc) | 2 | HREC0D760 (row 2573), HREC760 (row 2574) |
| West End Hospital | 2 | HREC0D761 (row 2575), HREC761 (row 2576) |
| Whitbless Africa | 2 | HREC0D762 (row 2581), HREC762 (row 2582) |
| Wilderness  Safari Camps | 2 | HREC0D793 (row 2588), HREC793 (row 2589) |
| Willowmead Junction | 2 | HREC0D764 (row 2591), HREC764 (row 2592) |
| Willsgrove Farm Enterprises | 2 | HREC0D765 (row 2595), HREC765 (row 2596) |
| Willsgrove Harare | 2 | BYOC0D253 (row 2598), BYOC0D254 (row 2599) |
| Willsgrove Harare Zig | 2 | BYOC221 (row 2600), BYOC222 (row 2601) |
| Y-Pay-Mor | 2 | HREC0D766 (row 2607), HREC766 (row 2608) |
| Zapalala Chegutu | 2 | HREC0D772 (row 2614), HREC772 (row 2615) |
| Zimbabwe National Defence University | 2 | HREC0D777 (row 2622), HREC777 (row 2623) |
| Zimbabwe Newspapers T/A Natprint | 2 | HREC0D402 (row 2624), HREC402 (row 2625) |
| Zpc Hostel | 2 | HREC0D783 (row 2637), HREC783 (row 2638) |
| Zpc Kariba | 2 | HREC0D782 (row 2639), HREC782 (row 2640) |
| Zuva Service Station -Cnr 4Th & S Machel | 2 | HREC0D784 (row 2643), HREC784 (row 2644) |
| Zuva Service Station -Montagu | 2 | HREC0D785 (row 2645), HREC785 (row 2646) |
| Zvinonaka Restaurant | 2 | HREC0D788 (row 2647), HREC788 (row 2648) |

## Advisory: near-duplicate names (case/whitespace differences only)

These groups are **not** counted in the exact-match total above -- they only collide once case and repeated internal whitespace are ignored. Listed for awareness only; no row was changed, merged, or dropped on account of this.

| Normalized name | Count | CUSTOMER_CODE / raw name (source row) |
|---|---|---|
| 1020-ok supermarkets masvingo | 3 | HREC0D488 / '1020-OK  Supermarkets Masvingo' (row 14), HREC488 / '1020-OK  Supermarkets Masvingo' (row 15), HREC860 / '1020-OK  Supermarkets Masvingo' (row 16) |
| 1040-ok supermarket - kuwadzana 2 | 3 | HREC0D474 / '1040-OK Supermarket  - Kuwadzana 2' (row 88), HREC474 / '1040-OK Supermarket  - Kuwadzana 2' (row 89), HREC884 / '1040-OK Supermarket  - Kuwadzana 2' (row 90) |
| 1070-bon marche' - westgate take-away | 3 | HREC0D435 / "1070-Bon  Marche' - Westgate Take-Away" (row 174), HREC435 / "1070-Bon  Marche' - Westgate Take-Away" (row 175), HREC913 / "1070-Bon  Marche' - Westgate Take-Away" (row 176) |
| archive it services | 2 | HREC0D750 / 'Archive  It Services' (row 304), HREC750 / 'Archive It Services' (row 305) |
| ebenezer star | 2 | HREC0D152 / 'Ebenezer  Star' (row 637), HREC152 / 'Ebenezer  Star' (row 638) |
| kefmeg investments t/a great zimbabwe hotel | 2 | BYOC0D272 / 'Kefmeg Investments  T/A Great Zimbabwe Hotel' (row 928), HREC0D944 / 'Kefmeg Investments  t/a Great Zimbabwe Hotel' (row 929) |
| ok supermarkets - hwange byo | 2 | BYOC244 / 'OK Supermarkets -  Hwange Byo' (row 1278), BYOC245 / 'OK Supermarkets -  Hwange Byo' (row 1279) |
| staff account - clemence t dongo | 2 | HREC0D146 / 'Staff Account - Clemence  T Dongo' (row 1747), HREC146 / 'Staff Account - Clemence  T Dongo' (row 1748) |
| tammy lodge t/a black rhino safaris | 2 | WFMCOD43 / 'Tammy Lodge T/A Black Rhino Safaris' (row 2219), WFMCOD77 / 'Tammy Lodge T/a Black Rhino Safaris' (row 2220) |
| tm supermarket (pvt) ltd - orr street | 2 | HREC705 / 'TM Supermarket (Pvt) Ltd  - Orr Street' (row 2273), HREC819 / 'TM Supermarket (Pvt) Ltd  - Orr Street' (row 2274) |
| tm supermarkets (pvt) ltd - arcadia | 2 | HREC666 / 'TM Supermarkets (Pvt) Ltd  - Arcadia' (row 2280), HREC0D666 / 'TM Supermarkets (Pvt) Ltd - Arcadia' (row 2394) |
| tm supermarkets (pvt) ltd - aspindale | 3 | HREC729 / 'TM Supermarkets (Pvt) Ltd  - Aspindale' (row 2282), HREC830 / 'TM Supermarkets (Pvt) Ltd  - Aspindale' (row 2283), HREC0D729 / 'TM Supermarkets (Pvt) Ltd - Aspindale' (row 2396) |
| tm supermarkets (pvt) ltd - bradfield zig | 2 | BYOC193 / 'TM Supermarkets (Pvt) Ltd  - Bradfield Zig' (row 2285), BYOC192 / 'TM Supermarkets (Pvt) Ltd - Bradfield Zig' (row 2401) |
| tm supermarkets (pvt) ltd - chegutu | 3 | HREC0D673 / 'TM Supermarkets (Pvt) Ltd  - Chegutu' (row 2291), HREC673 / 'TM Supermarkets (Pvt) Ltd  - Chegutu' (row 2292), HREC803 / 'TM Supermarkets (Pvt) Ltd  - Chegutu' (row 2293) |
| tm supermarkets (pvt) ltd - chinhoyi north | 3 | HREC677 / 'TM Supermarkets (Pvt) Ltd  - Chinhoyi North' (row 2294), HREC805 / 'TM Supermarkets (Pvt) Ltd  - Chinhoyi North' (row 2295), HREC0D677 / 'TM Supermarkets (Pvt) Ltd - Chinhoyi North' (row 2404) |
| tm supermarkets (pvt) ltd - chiredzi | 2 | HREC0D676 / 'TM Supermarkets (Pvt) Ltd  - Chiredzi' (row 2297), HREC676 / 'TM Supermarkets (Pvt) Ltd - Chiredzi' (row 2410) |
| tm supermarkets (pvt) ltd - dangamvura mutare | 2 | HREC680 / 'TM Supermarkets (Pvt) Ltd  - Dangamvura Mutare' (row 2301), HREC0D680 / 'TM Supermarkets (Pvt) Ltd - Dangamvura Mutare' (row 2417) |
| tm supermarkets (pvt) ltd - gwanda zig | 2 | BYOC134 / 'TM Supermarkets (Pvt) Ltd  - Gwanda Zig' (row 2304), BYOC135 / 'TM Supermarkets (Pvt) Ltd  - Gwanda Zig' (row 2305) |
| tm supermarkets (pvt) ltd - harare street | 3 | HREC0D683 / 'TM Supermarkets (Pvt) Ltd  - Harare Street' (row 2308), HREC683 / 'TM Supermarkets (Pvt) Ltd  - Harare Street' (row 2309), HREC808 / 'TM Supermarkets (Pvt) Ltd  - Harare Street' (row 2310) |
| tm supermarkets (pvt) ltd - highlands park | 3 | HREC727 / 'TM Supermarkets (Pvt) Ltd  - Highlands Park' (row 2311), HREC828 / 'TM Supermarkets (Pvt) Ltd  - Highlands Park' (row 2312), HREC0D727 / 'TM Supermarkets (Pvt) Ltd -  Highlands Park' (row 2391) |
| tm supermarkets (pvt) ltd - hogerty hills | 2 | HREC0D841 / 'TM Supermarkets (Pvt) Ltd  - Hogerty Hills' (row 2313), HREC841 / 'TM Supermarkets (Pvt) Ltd  - Hogerty Hills' (row 2314) |
| tm supermarkets (pvt) ltd - kamfinsa | 2 | HREC733 / 'TM Supermarkets (Pvt) Ltd  - Kamfinsa' (row 2320), HREC832 / 'TM Supermarkets (Pvt) Ltd  - Kamfinsa' (row 2321) |
| tm supermarkets (pvt) ltd - karoi | 4 | HREC0D690 / 'TM Supermarkets (Pvt) Ltd   - Karoi' (row 2278), HREC690 / 'TM Supermarkets (Pvt) Ltd  - Karoi' (row 2323), HREC811 / 'TM Supermarkets (Pvt) Ltd  - Karoi' (row 2324), HREC836 / 'TM Supermarkets (Pvt) Ltd  - Karoi' (row 2325) |
| tm supermarkets (pvt) ltd - kwekwe | 2 | HREC0D691 / 'TM Supermarkets (Pvt) Ltd -  Kwekwe' (row 2392), HREC691 / 'TM Supermarkets (Pvt) Ltd -  Kwekwe' (row 2393) |
| tm supermarkets (pvt) ltd - kwekwe zig | 2 | BYOC208 / 'TM Supermarkets (Pvt) Ltd  - Kwekwe Zig' (row 2327), BYOC207 / 'TM Supermarkets (Pvt) Ltd - Kwekwe Zig' (row 2431) |
| tm supermarkets (pvt) ltd - madokero | 3 | HREC0D726 / 'TM Supermarkets (Pvt) Ltd  - Madokero' (row 2329), HREC726 / 'TM Supermarkets (Pvt) Ltd  - Madokero' (row 2330), HREC827 / 'TM Supermarkets (Pvt) Ltd  - Madokero' (row 2331) |
| tm supermarkets (pvt) ltd - magaba | 2 | HREC0D693 / 'TM Supermarkets (Pvt) Ltd  - Magaba' (row 2332), HREC693 / 'TM Supermarkets (Pvt) Ltd - Magaba' (row 2434) |
| tm supermarkets (pvt) ltd - msasa | 2 | HREC699 / 'TM Supermarkets (Pvt) Ltd  - Msasa' (row 2336), HREC814 / 'TM Supermarkets (Pvt) Ltd  - Msasa' (row 2337) |
| tm supermarkets (pvt) ltd - mutare | 3 | HREC0D701 / 'TM Supermarkets (Pvt) Ltd  - Mutare' (row 2338), HREC701 / 'TM Supermarkets (Pvt) Ltd  - Mutare' (row 2339), HREC816 / 'TM Supermarkets (Pvt) Ltd  - Mutare' (row 2340) |
| tm supermarkets (pvt) ltd - mutoko | 3 | HREC700 / 'TM Supermarkets (Pvt) Ltd  - Mutoko' (row 2341), HREC815 / 'TM Supermarkets (Pvt) Ltd  - Mutoko' (row 2342), HREC0D700 / 'TM Supermarkets (Pvt) Ltd - Mutoko' (row 2441) |
| tm supermarkets (pvt) ltd - newlands | 3 | HREC0D702 / 'TM Supermarkets (Pvt) Ltd  - Newlands' (row 2343), HREC702 / 'TM Supermarkets (Pvt) Ltd  - Newlands' (row 2344), HREC817 / 'TM Supermarkets (Pvt) Ltd  - Newlands' (row 2345) |
| tm supermarkets (pvt) ltd - northend | 2 | HREC0D704 / 'TM Supermarkets (Pvt) Ltd  - Northend' (row 2346), HREC704 / 'TM Supermarkets (Pvt) Ltd  - Northend' (row 2347) |
| tm supermarkets (pvt) ltd - norton | 3 | HREC0D703 / 'TM Supermarkets (Pvt) Ltd  - Norton' (row 2349), HREC703 / 'TM Supermarkets (Pvt) Ltd  - Norton' (row 2350), HREC818 / 'TM Supermarkets (Pvt) Ltd  - Norton' (row 2351) |
| tm supermarkets (pvt) ltd - rusape | 3 | HREC0D711 / 'TM Supermarkets (Pvt) Ltd  - Rusape' (row 2353), HREC711 / 'TM Supermarkets (Pvt) Ltd  - Rusape' (row 2354), HREC822 / 'TM Supermarkets (Pvt) Ltd  - Rusape' (row 2355) |
| tm supermarkets (pvt) ltd - shurugwi | 4 | BYOC0D274 / 'TM Supermarkets (Pvt) Ltd  - Shurugwi' (row 2357), BYOC274 / 'TM Supermarkets (Pvt) Ltd  - Shurugwi' (row 2358), HREC0D958 / 'TM Supermarkets (Pvt) Ltd  - Shurugwi' (row 2359), HREC958 / 'TM Supermarkets (Pvt) Ltd  - Shurugwi' (row 2360) |
| tm supermarkets (pvt) ltd - simon mazorodze | 3 | HREC0D736 / 'TM Supermarkets (Pvt) Ltd  - Simon Mazorodze' (row 2361), HREC736 / 'TM Supermarkets (Pvt) Ltd  - Simon Mazorodze' (row 2362), HREC835 / 'TM Supermarkets (Pvt) Ltd  - Simon Mazorodze' (row 2363) |
| tm supermarkets (pvt) ltd - zvishavane | 2 | HREC0D710 / 'TM Supermarkets (Pvt) Ltd  - Zvishavane' (row 2367), HREC710 / 'TM Supermarkets (Pvt) Ltd - Zvishavane' (row 2459) |
| tm supermarkets (pvt) ltd -arundel | 3 | HREC0D728 / 'TM Supermarkets (Pvt) Ltd  -Arundel' (row 2369), HREC728 / 'TM Supermarkets (Pvt) Ltd  -Arundel' (row 2370), HREC829 / 'TM Supermarkets (Pvt) Ltd  -Arundel' (row 2371) |
| tm supermarkets (pvt) ltd -chikanga mutare | 2 | HREC674 / 'TM Supermarkets (Pvt) Ltd  -Chikanga Mutare' (row 2372), HREC0D674 / 'TM Supermarkets (Pvt) Ltd -Chikanga Mutare' (row 2461) |
| tm supermarkets (pvt) ltd -marondera main | 3 | HREC0D698 / 'TM Supermarkets (Pvt) Ltd  -Marondera Main' (row 2378), HREC698 / 'TM Supermarkets (Pvt) Ltd  -Marondera Main' (row 2379), HREC813 / 'TM Supermarkets (Pvt) Ltd  -Marondera Main' (row 2380) |
| tm supermarkets (pvt) ltd -marondera oak | 2 | HREC697 / 'TM Supermarkets (Pvt) Ltd  -Marondera Oak' (row 2381), HREC0D697 / 'TM Supermarkets (Pvt) Ltd -Marondera Oak' (row 2469) |
| tm supermarkets (pvt) ltd -sakubva mutare | 3 | HREC0D713 / 'TM Supermarkets (Pvt) Ltd  -Sakubva Mutare' (row 2382), HREC713 / 'TM Supermarkets (Pvt) Ltd  -Sakubva Mutare' (row 2383), HREC824 / 'TM Supermarkets (Pvt) Ltd  -Sakubva Mutare' (row 2384) |
| tm supermarkets (pvt) ltd -westgate | 3 | HREC0D735 / 'TM Supermarkets (Pvt) Ltd  -Westgate' (row 2385), HREC735 / 'TM Supermarkets (Pvt) Ltd  -Westgate' (row 2386), HREC834 / 'TM Supermarkets (Pvt) Ltd  -Westgate' (row 2387) |
| tm supermarkets (pvt) ltd karoi t/away | 2 | HREC0D714 / 'TM Supermarkets (Pvt) Ltd  Karoi T/Away' (row 2388), HREC714 / 'TM Supermarkets (Pvt) Ltd  Karoi T/Away' (row 2389) |
| wilderness safari camps | 2 | HREC0D793 / 'Wilderness  Safari Camps' (row 2588), HREC793 / 'Wilderness  Safari Camps' (row 2589) |

## Columns present in the source but not carried into the CSV

| Source column | Why it was not carried over |
|---|---|
| `#` | A row sequence number from the export; not part of the customer-master contract. |
| `Account Balance` | Not the same concept as `CREDIT_LIMIT` (a current balance vs. a maximum limit) -- mapping one onto the other would be a fabricated figure, not a transcription. No contract column represents an account balance. |
| `Account Balance FC` | Same reasoning as `Account Balance` (foreign-currency balance). |
| `Gaap Supplier Code` | Blank for all 2647 source rows (confirmed by inspection) and has no corresponding column in the contract regardless. |

## Contract columns with no source data (left blank, not fabricated)

`TIN`, `VAT_REG`, `CURRENCY`, `PRICE_LIST_CODE`, `PAYMENT_TERMS`, `BRANCH_CODE`, `STORE_CODE`, `CREDIT_LIMIT`, `ADDRESS_LINE1`, `CITY`, `PHONE`, `EMAIL`, `CONTACT_NAME`, `CONTACT_EMAIL`, `CONTACT_PHONE` -- the source workbook carries none of this data, so every row has these columns blank rather than guessed.

`CREDIT_HOLD` is the one exception: every row is written as `N` (not on hold). The source has no hold data either, but the contract's own documented rule already treats a blank the same as `N` -- writing `N` explicitly just makes that default visible rather than leaving it implicit. Confirm with the business that defaulting every imported customer to "not on credit hold" is correct before import.

