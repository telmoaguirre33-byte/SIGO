-- SIGO: carga inicial controlada de Sertec, lote 04.
-- Registros fuente en este lote: 100. No sobrescribe productos existentes.
do $$
declare
  v_inserted integer;
begin
  select public.sigo_importar_stock_resguardo(
    'Sertec',
    'resguardo-stock-sigo-2026-09-09-sertec-04',
    $stock$
	0305	tinta 504 negro	15000	3		0		Computación
6935482112382		toner 217	18000	1		0		Computación
	0307	drum 1060	18000	6		0		Computación
1124060898002		pendrive 64gb	23000	2		0		Computación
	0309	toner 310 negro	15000	1		0		Computación
	0310	cargador notebook mixor nexo	25000	0				Computación
	0311	usb C	4000	0				Computación
	0312	Pendrive 64GB	15000	0				Computación
	0313	Cargador notebook Letos (calidad)	49000	1		0		Computación
	0314	cable hdmi 1m	6000	2		2000		Computación
	0315	cartucho epson viejos	11000	26		0		Computación
	0316	funda notebook	30000	1		15000		Computación
	0317	tv stick	62400	1		39000		Computación
700306606240		pad gamer mp756	19600	0				Computación
700306606257		pad gamer mp758	27000	1		13500		Computación
	0320	toner pantum 279	26000	0				Computación
	0321	mouse genius dx123	14000	1		7000		Computación
7798137716477		MOUSE NOGA LED COLORS	15600	1		7800		Computación
4710268251682		teclado genius kb-125	15000	1		7500		Computación
	0324	teclado netmak como inalambrico	27000	1		13500		Computación
	0325	router	48000	1		24000		Computación
091163262282		mouse genius dx110	10000	1		5000		Computación
	0327	mouse netmak m680	11000	2		5500		Computación
	0328	glass 9d	7000	30		0		Computación
	0329	cargador mobile 35w	13000	3		6500		Computación
	0330	cargador mobile 65w	19500	0				Computación
	0331	cargador mobile 45w	16000	3		8000		Computación
000006124120		cargador pro 21 tc	8000	0				Computación
	0333	adaptador internacional	7000	0				Computación
	0334	auricular TWMS mixor claridad	20000	1		10000		Computación
	0335	auricular deportivo air pro dash	56000	1		6500		Computación
	0336	auricular gamer dash 120	22000	1		11000		Computación
	0337	pasta termica mx-4	16000	3		0		Computación
	0338	Hidroglass	8000	70		3000		Computación
	0339	hydroglass	8000	59		0		Computación
	0340	ering	2000	20		0		Computación
	0341	tinta brt50 Negro	6000	2		0		Computación
	0342	tinta brt60	8000	1		0		Computación
	0343	ering	3000	20		0		Computación
	0344	cable display port	24000	0				Computación
7898722600065		Disco Solido Keep Data	0	0				Computación
7798162831374		adaptador USB	8000	0				Computación
	www.netmak.com.ar	CARGADOR UNIVERSAL NETMAK	49990	1		0		Computación
	0348	CAMARA DE SEGURIDAD OM	39000	0				Computación
7798137724854		teclado Noga NKB 1300	18800	1		9400		Computación
7798137702432		CABLE  HDMI 3 MTS	7600	0				Computación
7798137713858		CABLE DE RED 20 MT.	17800	1		8900		Computación
7798137697943		CABLE DE RED 10 M	11200	0				Computación
7798137713841		CABLE DE RED 15MT	13800	1		6900		Computación
7798137697929		CABLE DE RED 3M	6000	0				Computación
7798137704368		CABLE SATA POWER	3000	0				Computación
7798137725172		CABLE DISPLAY PORT A DISPLAY `PORT	15600	2		7800		Computación
	0357	USB IMPRESORA	8200	1		4100		Computación
7792641881997		ADAPTADOR C A SATA	24200	1		12100		Computación
	0359	CABLE SATA DATOS	3200	3		1600		Computación
	0360	CABLE POWER 220 NETMARK	11000	1		5500		Computación
	0361	CABLE POWER PC	8600	1		4300		Computación
763571815076		CARGADOR UNIVERSAL OM	25800	1		12900		Computación
7798137702425		CABLE HDMI 2M	5200	0				Computación
	0364	HDMI to mini HDMI 1,5 Netmak	9000	1		0		Computación
	0365	Cable usb macho hembra 2.0	6000	1		0		Computación
	0366	adaptador usb paralelo	7500	1		0		Computación
6939050310514		cartucho 73 negro	6000	2		3000		Computación
6939050313331		Cartucho 133 magenta	6000	4		3000		Computación
6939050310521		Cartucho Cyan 73	6000	3		3000		Computación
6939050313348		cartucho 133 yellow	6000	5		3000		Computación
6939050311719		CARTUCHO 117	6000	2		3000		Computación
6939050313317		CARTUCHO 133B NEGRO	6000	3		3000		Computación
6939050309013		CARTUCHO 90 N	6000	0				Computación
6939050310538		CARTUCHO 73 MAGENTA	6000	0				Computación
6939050310545		CARTUCHO 73 YELLO	6000	0				Computación
6939050313324		CARTUCHO 133 CYAN	6000	3		3000		Computación
	0377	BRT50 CYAN	6000	3		3000		Computación
	0378	BRT 50 MAGENTA	6000	2		3000		Computación
	0379	BRT 50 YELLOW	6000	2		3000		Computación
110733027		USB TC	8000	1		4000		Computación
6921113992614		CARGADOR 66W.	18000	2		10000		Computación
6984400137037		USB	3000	1		1500		Computación
6921113992607		USB C	4000	4		2000		Computación
6934177708800		AURICULAR INALAMBRICO	12600	2		7000		Computación
6920250086101		TIMBRE	14000	2		7000		Computación
7823050150319		FOCO LUZ EMERGENCIA	9800	2		5400		Computación
041333014630		PILAS DURACELL AA	5000	1		2500		Computación
7896067203170		PILAS AA PANASONIC	3500	13		1300		Computación
7896067203040		PILAS AAA PANASONIC	3400	8		1200		Computación
6913111176240		PRECINTO CHICO	7000	2		3500		Computación
6913111731647		PRECINTO GRANDE	7600	1		3800		Computación
7798137388353		JOYSTICK PC NOGA	28000	1		0		Computación
6918882660059		CARGADOR PORTATIL	24000	1		0		Computación
	0394	CAPTURADORA DE VIDEO	24000	1		0		Computación
	0395	GNTO505U	25000	1		0		Computación
6936482101536		TONER 219	23000	2		0		Computación
	0397	TONER DOC-H-297A	23000	2		0		Computación
6935482103267		TONER DR1060	21000	0				Computación
7798417910168		TONER 106R02773	22000	1		0		Computación
6942937508935		TONER LM E260	27000	2		0		Computación
	0401	microSD 16 GB	21000	4		0		Computación
	0402	mouse noga ng 661	12000	2		6000		Computación
	0403	mouse netmak m625	10000	0				Computación
	0404	mouse inalambrico genius nx7000	23000	1		11500		Computación
$stock$
  ) into v_inserted;

  raise notice 'SIGO_STOCK_IMPORT_CHUNK_OK company=Sertec lote=04 source=100 inserted=% skipped=%',
    v_inserted, 100 - v_inserted;
end
$$;
