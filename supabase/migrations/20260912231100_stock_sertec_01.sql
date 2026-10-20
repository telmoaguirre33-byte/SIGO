-- SIGO: carga inicial controlada de Sertec, lote 01.
-- Registros fuente en este lote: 100. No sobrescribe productos existentes.
do $$
declare
  v_inserted integer;
begin
  select public.sigo_importar_stock_resguardo(
    'Sertec',
    'resguardo-stock-sigo-2026-09-09-sertec-01',
    $stock$
	GN662CXL	cartucho 662 color	43000	2		28061.56		Computación
	GN664BXLNC	cartucho 664 bxlnc negro	52020	1		28900		Computación
	GN664CXLNC	cartucho 664 cxln color	52200	0				Computación
	GN662BXL	cartucho 662 bxl negro	57800	1		28900		Computación
	GN667BXL	cartucho 667 bxl negro	62000	1		33900		Computación
	GN60BXL	cartucho 60 bxl negro	46800	0				Computación
	GN60CXL	cartucho 60 cxl color	48600	1		27000		Computación
	GNHP27	cartucho hp 27 negro	36000	1		18000		Computación
	GN122CXL	cartucho 122 cxl color	52020	2		28900		Computación
	GN22	cartucho 22 cxl color	43500	2		29000		Computación
	GN21	cartucho 21 bxl negro	40000	1		20000		Computación
	GNHP92	cartucho hp 92 negro	40500	1		27000		Computación
6939050329622		cartucho 296 yxl amarillo	12000	6		6000		Computación
6939050329608		cartucho 296 cxl cyan	12000	3		6000		Computación
6939050329615		cartucho 296 mxl magenta	12000	5		6000		Computación
6939050319715		cartucho 197 bxl negro	11000	1		5500		Computación
6939050306340		cartucho 63 y amarillo	6000	2		4000		Computación
6939050306319		cartucho 63 b negro	6000	1		4000		Computación
6939050311511		cartucho 115 bk negro	6000	4		4000		Computación
6939050306333		cartucho 63 m magenta	6000	4		4000		Computación
6939050306326		cartucho 36 c cyan	6000	4		4000		Computación
6939050319623		cartucho 196 cxl cyan	11000	2		5500		Computación
6939050319647		cartucho 196 yxl amarillo	11000	3		5500		Computación
6935482103250		toner LA-BRT1060 brother	15000	10		7500		Computación
6935482105322		toner GN-TOCE310U	13000	2		8500		Computación
6935482105346		toner GN-TOCE312U	24000	1		8500		Computación
6935482105353		toner GN-TOCE313U	20000	1		8500		Computación
6935482105339		toner GN-TOCE311U	23000	1		8500		Computación
6935482096972		drum hp GN-TOCE314 AD	21000	1		14000		Computación
6935482094817		toner gn-totn450u	15300	7		8500		Computación
6935482113761		toner gn-tow1105a	17500	2		9939		Computación
6935482106589		toner gn-tod111lnc	16500	3		11000		Computación
6935482113686		toner gn-tow1103a	9000	1		6000		Computación
6950840630056		toner cbp-tn360	21000	3		14000		Computación
6935482090000		toner gn-to2612a	15000	3		7000		Computación
6935482097986		toner gn-totn580	22000	2		14500		Computación
6936482093329		toner gn-toxe3020	16500	2		11000		Computación
6935482090727		toner gn-totn360	19500	1		13000		Computación
	GN667CXL	cartucho 667 cxl color	62000	1		33900		Computación
	0044	tinta GN-EPT554B NEGRO	6000	1		3000		Computación
8699258564291		receptor wifi con antena	13500	0				Computación
	TN570COMP	toner tn570comp	30000	4		20000		Computación
6935482107630		toner gn-tocf230a (con chip)	12000	2		8000		Computación
6935482105568		toner gn-tocf226a	24000	3		12000		Computación
6935482095449		toner gn-todr420u	18000	1		12000		Computación
6935482107272		toner gn-totn880	31000	1		16000		Computación
6935482097665		toner gn-tod103l	25500	3		17000		Computación
	MLTD104SCOMP	toner gn-tod104s	19500	1		13000		Computación
6935482093674		toner gn-tod105l	27000	2		18000		Computación
6935482091762		toner gn-to1640	27000	1		16000		Computación
	0055	tinta gn-ept544c cyan	6000	9		3000		Computación
	0056	tinta gn-ept544y amarillo	6000	9		3000		Computación
	0057	tinta gn-ept544m magenta	6000	15		3000		Computación
	0058	tinta gn-ept664b negro	6000	5		3000		Computación
	0059	tinta gn-ept664y amarillo	6000	6		3000		Computación
	0060	tinta gn-ept664c cyan	6000	6		3000		Computación
	0061	tinta gn-ept664m magenta	6000	8		3000		Computación
	0062	tinta gn-hgt51b negro	6000	7		3000		Computación
	0063	tinta gn-hgt52y amarillo	6000	6		3000		Computación
	0064	tinta gn-hgt52m magenta	6000	0				Computación
	0065	tinta gn-hgt52c cyan	6000	1		3000		Computación
	0066	teclado y mouse netmak nm-kb325	21000	0				Computación
112406009		mouse y teclado inalambrico only	26000	0				Computación
7798137712516		teclado noga	10000	0				Computación
700306603003		mouse pad gel netmak	10000	0				Computación
719181036561		mando doubleshock	15000	0				Computación
700306602211		auricular counter	20000	0				Computación
700306601368		auricular shadow	15000	0				Computación
112402002		usb 32gb only	13000	0				Computación
1124100203		usb 64gb mixor	15000	1		0		Computación
619659161644		adaptado microSD 32gb	33000	6		0		Computación
7798347085509		pilas AA	1500	1		0		Computación
700306601498		pilas placa-madre	1500	11		720		Computación
	0078	cables fuente-pc	5000	0				Computación
	0079	cable funte-impresora	24000	0				Computación
	0080	cable usb-mini	4000	1		0		Computación
7792641880259		cable stereo	3000	3		0		Computación
	0082	cable Conversor VGA a hdmi	32000	2		16000		Computación
110715302		cable usb a usb tipo c	4000	5		0		Computación
	0084	adaptador usb a conector samsung	4000	0				Computación
7898001637362		mouse yelandar	9500	1		0		Computación
091163260493		mouse wireless Genius	15000	0				Computación
	JJMG30313	adaptador displayport a HDMI	7000	2		0		Computación
8201206261376		mouse wireless 4d	10000	0				Computación
110731001		cable usb tipo c mixor	4000	1		0		Computación
110801054		cargador tipo c only	15000	1		0		Computación
000006124052		cargador tipo c	15000	2		0		Computación
110733036		cable usb tipo c mixor	4000	5		0		Computación
7799061004364		cargador inteligente inava	35000	1		0		Computación
110715807		cable usb lion	7000	1		0		Computación
7792641880921		cable adaptador auxiliar nm-c92	3000	1		0		Computación
11040102903		auricular mixor	12000	1		0		Computación
110701010		cargador usb de auto	5000	0				Computación
6918888886118		mouse cable ezra	10000	0				Computación
11130400304		cable auxiliar	5000	2		2500		Computación
8397679206355		mando nv-ps4001	42000	0				Computación
701575362356		cable HDMI 5m	17000	1		0		Computación
7798137709516		cable extensor de usb	5000	2		0		Computación
	0103	cable impresora	24000	7		12000		Computación
7792641895055		usb hum 4 puertos	6000	1		0		Computación
$stock$
  ) into v_inserted;

  raise notice 'SIGO_STOCK_IMPORT_CHUNK_OK company=Sertec lote=01 source=100 inserted=% skipped=%',
    v_inserted, 100 - v_inserted;
end
$$;
