-- SIGO: carga inicial controlada de Sertec, lote 05.
-- Registros fuente en este lote: 17. No sobrescribe productos existentes.
do $$
declare
  v_inserted integer;
begin
  select public.sigo_importar_stock_resguardo(
    'Sertec',
    'resguardo-stock-sigo-2026-09-09-sertec-05',
    $stock$
	0405	mouse netmak recargable 90w	18000	1		9000		Computación
	0406	cargador automatico xaea 30w	48000	2		24000		Computación
	0407	tinta epson 500cc blue ink-ink tec	25000	4		13500		Computación
	0408	tinta epson 250cc blue ink-ink tac	13500	7		6750		Computación
	0409	teclado netmak formato compacto-ultra slim	18000	1		9000		Computación
	0410	redmi airdotspro	15000	2		0		Computación
30199675761		ssd hiksemi 24GB	124200	1		69000		Computación
30199425235		ssd hiksemi 120	96000	3		48000		Computación
	0413	MOUSE Q BOX	14800	0				Computación
	httpsñ--docqr.tricomex.com.ar-sentey-fuente?de?alimentacion-94432	FUENTE LNZ 550 XS SERIES	36000	4		18000		Computación
	0416	memoria microSD 128GB	28000	0				Computación
	0417	adaptador C a HDMI (TYPE C TO HD cable))	20000	1		10000		Computación
	0418	toner w1500a (compatible 150A)	19000	2		9500		Computación
	0419	parlante NG-512 Noga	19500	1		9600		Computación
	0420	parlante caja madera netmak Bora	38000	1		19000		Computación
	0421	toner 880	42000	1		21000		Computación
	0422	mouse mixor agil	9000	3		3000		Computación
$stock$
  ) into v_inserted;

  raise notice 'SIGO_STOCK_IMPORT_CHUNK_OK company=Sertec lote=05 source=17 inserted=% skipped=%',
    v_inserted, 17 - v_inserted;
end
$$;
