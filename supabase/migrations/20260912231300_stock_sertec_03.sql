-- SIGO: carga inicial controlada de Sertec, lote 03.
-- Registros fuente en este lote: 100. No sobrescribe productos existentes.
do $$
declare
  v_inserted integer;
begin
  select public.sigo_importar_stock_resguardo(
    'Sertec',
    'resguardo-stock-sigo-2026-09-09-sertec-03',
    $stock$
	0205	Tinta 555 amarillo	6000	1		2700		Computación
	0206	Tinta cian 555	6000	1		2700		Computación
	0207	Tinta 555 magenta	6000	1		2700		Computación
	0208	Tinta 555 negro	6000	1		2700		Computación
	0209	RECARGA DE TINTA	5000					Computación
7799135009868		MOUSE AITECH	4600	0				Computación
539035001756		Teclado aitech	12400	0				Computación
7799135009783		Teclado + Mouse	23400	1		11700		Computación
779813724601		Repetidor wifi	35000	0				Computación
	0214	Bluetooth para Pc	7000	3		3800		Computación
619659182274		Pendrive ScanDisk 32 GB	14800	0				Computación
619659171797		Pendrive ScanDisk Cruzer fit	15500	0				Computación
	0217	Cargador automático ONLY	37800	0				Computación
11081503300020		Cargador Mixor 9 pines	27000	3		13500		Computación
30175048448		SSD HIKSEMI 240GB	153600	2		96000		Computación
	0220	TINTA 544 NEGRO	8000	13		4000		Computación
	0221	TONER 150 HP SIN CHIP	24600	0				Computación
	0222	USB BLUETOOTH PC	16000	0				Computación
	0223	FUENTE PC 550 W	48600	2		24300		Computación
	0224	MOUSSE INALÁMBRICO CLIK ONLY	11200	2		5600		Computación
1109040111901		Ultrapods pro	12000	0				Computación
1109040812301		Headphones	17600	0				Computación
1113060313702		USB iphone	3000	0				Computación
7798137714923		Adaptador wifi	15000	2		7500		Computación
7798137724601		Repetidor wiriles Noga	80000	1		40000		Computación
	0230	TINTA GNEIS 664 LIGHT CYAN	8000	1		4000		Computación
	0231	TINTA GNEIS 664 LIGHT MAGENTA	8000	1		4000		Computación
	0232	GRASA SILICONADA	9100	3		6500		Computación
	0233	FUNDA GLITTER	9000	3		4500		Computación
	0234	Funda Reptil	7000	2		2700		Computación
	0235	Funda Magnetica	8500	0				Computación
	11240808J0200	Control	26000	0				Computación
6936709099851		Piñas AAA	3600	10		2000		Computación
	0238	Joystick de pc	25800	1		12900		Computación
	0239	Pasta térmica netmak	14000	4		7000		Computación
	0240	Cable Plug a 2 rca	3500	1		1590		Computación
	0241	TONER 104	27800	0				Computación
112404019		Mouse inalámbrico Only	9600	1		6000		Computación
091163250975		Mouse 1	10000	1		0		Computación
	0244	TONER 285	29800	0				Computación
	0245	CARTUCHO 296 NEGRO	22000	2		11000		Computación
	0246	Cartucho hp 60 negro	52020	1		28900		Computación
	0247	Cable Mobile c-c	4500	0				Computación
700306605571		Teclado Nm 408	25000	0				Computación
700306605564		Teclado NM 402	20800	0				Computación
	0250	Power bank 200000	23500	1		15500		Computación
	0251	662B Hp	57800	1		28900		Computación
	0252	BATERIA UPS	46000	3		29800		Computación
	0253	TINTA GT51	6000	0				Computación
	0254	TINTA GT52 MAGENTA	6000	0				Computación
	0255	Mouse Genius	20000	0				Computación
6935482103519		Tóner 283a	16600	4		8300		Computación
	0257	HUB 4 PUERTOS 2.0	15600	0				Computación
	0258	HUB 4 PUERTOS 3.0	14700	2		7350		Computación
6936709099806		PILAS AA X 4	6300	4		3300		Computación
	0260	CARGADOR MIXOR 6.4 C	7600	1		3800		Computación
	0261	CARGADOR MIXOR 6.4 V8	7600	2		3800		Computación
	0262	CABLE MOBILE C	4400	1		2200		Computación
	0263	TECLADO NOGA USB	14000	0				Computación
700306605427		TECLADO INALAMBRICO NETMAK	46620	0				Computación
7798145011113		Pad Dinax	5000	1		2500		Computación
700306604598		MOUSE INALAMBRICO NETMARK	13000	1		7500		Computación
700306606561		Cooler 12x12	19000	4		9500		Computación
700306606530		Cooler 8x8	10000	3		5000		Computación
	00VP03008N004	Auricular Fusión Mixor	15000	1		7500		Computación
	]C100VP0300B6008	Auricular sensación mixor	16600	1		8300		Computación
	0271	Auricular v5.3	11200	1		5600		Computación
700306602280		Parlante Netmak	21600	0				Computación
	]C11124070406602	Micrófono Ryzen	51200	1		25600		Computación
700306606592		Micrófono netmaj	23800	1		11900		Computación
	0275	camera de seguridad OM	40500	1		22500		Computación
700306607155		Camera de seguridad	55000	1		24900		Computación
700306606271		Cámara de seguridad	49800	1		24900		Computación
700306607483		Teclado Netmak colores	55800	2		27900		Computación
	0279	Auricular V5.1 FLUX	15800	0				Computación
792231720276		FUENTE PC 600W NOGA RGB	73000	0				Computación
	0281	CABLE NETMAK VGA 3M	15600	0				Computación
1124100405202		Mouse XAEA	8000	1		4000		Computación
1113060410601		Cable USB CA IPHONE	7600	3		3800		Computación
6939050329707		297 GNEIS NEGRO	12000	7		6000		Computación
	]C1GN664CXLNC	CARTUCHO 664 COLOR	59600	1		29800		Computación
	0286	Repetidor wifi	35000	0				Computación
6939050319630		Cartucho 196 Magenta	11000	2		5500		Computación
1113060410602		CARGADOR TIPO C XAEA	10000	4		5000		Computación
1124060897902		PEN DRIVE 32G	19000	0				Computación
	0290	Boos chager	27500	0				Computación
	0291	TONER 105 HP CPN CHIP	23000	1		11500		Computación
194252156926		CARGADOR IPHONE C	16000	4		8000		Computación
	0293	cargador notebook om	25000	3		12500		Computación
	GN122BXL	cartucho 122 negro	52020	1		28900		Computación
700306604055		auricular inalambrico netmak biza	29500	2		14750		Computación
	00X603009E008	auricular inalambrico claridad	33000	3		12500		Computación
700306605502		teclado mecanico netmak legend	55800	1		0		Computación
	0298	resma koby 75g	9300	3		0		Computación
	0299	birome bic 3 unidades	4000	3		0		Computación
	0300	birome bic 4 unidades	5000	1		0		Computación
	0301	cargador celular home charger	8000	0				Computación
	0302	teclado netmak estandar	11000	3		5500		Computación
	2EQI9400DS002	mouse inalambrico yexa	16000	2		5500		Computación
	0304	auricular chico samsung	3000	3		1500		Computación
$stock$
  ) into v_inserted;

  raise notice 'SIGO_STOCK_IMPORT_CHUNK_OK company=Sertec lote=03 source=100 inserted=% skipped=%',
    v_inserted, 100 - v_inserted;
end
$$;
