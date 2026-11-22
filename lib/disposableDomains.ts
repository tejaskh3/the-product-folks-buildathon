// Common throwaway-email domains, built in (no runtime fetch). A modest list of the domains
// seen most often; it's a speed bump for farming free papers, not a complete blocklist.
// Subdomains match too (x.mailinator.com → mailinator.com), see isDisposableEmail.
//
// Left out on purpose: real providers that are sometimes abused (yeah.net, cock.li, mail.by)
// and privacy aliases people use as their main address (SimpleLogin, addy.io, Apple, Firefox Relay).
const LIST = `
0-mail.com 027168.com 0815.ru 0clickemail.com 10minmail.com 10minutemail.co.uk 10minutemail.com 10minutemail.de
10minutemail.net 10minutemail.org 1secmail.com 1secmail.net 1secmail.org 20minutemail.com 20minutemail.it 2prong.com
30minutemail.com 33mail.com 3d-painting.com 4warding.com 4warding.net 60minutemail.com 675hosting.com 6paq.com 7tags.com
9ox.net anonbox.net anonymbox.com antichef.com antispam.de armyspy.com asdasd.ru bccto.me beefmilk.com binkmail.com
bobmail.info bofthew.com bootybay.de boun.cr bouncr.com brefmail.com bsnow.net bspamfree.org bugmenot.com bumpymail.com
burnermail.io byom.de cachedot.net casualdx.com chacuo.net chammy.info cheatmail.de chogmail.com choicemail1.com
clixser.com consumerriot.com cool.fr.nf correo.blogos.net cosmorph.com courriel.fr.nf courrieltemporaire.com
crapmail.org cubiclink.com curryworld.de cust.in cuvox.de dacoolest.com dandikmail.com dayrep.com dcctb.com dcemail.com
deadaddress.com deadspam.com delikkt.de despam.it despammed.com devnullmail.com dfgh.net digitalsanctuary.com
discard.email discardmail.com discardmail.de disposableaddress.com disposableemailaddresses.com disposableinbox.com
dispose.it disposeamail.com disposemail.com dispostable.com dodgeit.com dodgit.com donemail.ru dontreg.com
dontsendmespam.de dpptd.com drdrb.com drdrb.net droplar.com dropmail.me dump-email.info dumpandjunk.com dumpmail.de
dumpyemail.com e4ward.com easytrashmail.com einrot.com email60.com emailage.cf emaildienst.de emailfake.com emailgo.de
emailias.com emailigo.de emailinfive.com emaillime.com emailmiser.com emailondeck.com emailsensei.com
emailtemporanea.com emailtemporanea.net emailtemporar.ro emailtemporario.com.br emailthe.net emailtmp.com emailto.de
emailwarden.com emailx.at.hm emailxfer.com emeil.in emeil.ir emlhub.com emlpro.com emltmp.com emz.net enterto.com
ephemail.net etranquil.com etranquil.net etranquil.org evopo.com explodemail.com eyepaste.com ezztt.com fakeinbox.com
fakeinformation.com fakemail.fr fakemailgenerator.com fakemailz.com fammix.com fansworldwide.de fantasymail.de
fastacura.com fastchevy.com fastchrysler.com fastkawasaki.com fastmazda.com fastmitsubishi.com fastnissan.com
fastsubaru.com fastsuzuki.com fasttoyota.com fastyamaha.com fexbox.org fexpost.com fextemp.com fightallspam.com
filzmail.com fizmail.com fleckens.hu flyspam.com fr33mail.info frapmail.com friendlymail.co.uk front14.org
fuckingduh.com fudgerub.com fux0ringduh.com garliclife.com get1mail.com get2mail.fr getairmail.com getmails.eu
getnada.com getonemail.com getonemail.net ghosttexter.de girlsundertheinfluence.com gishpuppy.com gmailnator.com
gowikibooks.com gowikicampus.com gowikicars.com gowikifilms.com gowikigames.com gowikimusic.com gowikinetwork.com
gowikitravel.com gowikitv.com great-host.in greensloth.com grr.la gsrv.co.uk guerillamail.biz guerillamail.com
guerillamail.de guerillamail.info guerillamail.net guerillamail.org guerrillamail.biz guerrillamail.com
guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org guerrillamailblock.com gustr.com h8s.org
haltospam.com harakirimail.com hatespam.org herp.in hidemail.de hidzz.com hmamail.com hochsitze.com hopemail.biz
hulapla.de icznn.com ieatspam.eu ieatspam.info ihateyoualot.info iheartspam.org imails.info inbax.tk inboxalias.com
inboxbear.com inboxclean.com inboxclean.org inboxkitten.com incognitomail.com incognitomail.net incognitomail.org
insorg-mail.info instant-mail.de ipoo.org irish2me.com jetable.com jetable.fr.nf jetable.net jetable.org jnxjn.com
jourrapide.com junk1e.com kasmail.com kaspop.com keepmymail.com killmail.com killmail.net kimsdisk.com kingsq.ga
kir.ch.tc klassmaster.com klassmaster.net klzlk.com koszmail.pl kulturbetrieb.info kurzepost.de kzccv.com laafd.com
lawlita.com letthemeatspam.com lhsdv.com lifebyfood.com link2mail.net linshiyouxiang.net litedrop.com lookugly.com
lopl.co.cc lortemail.dk lovemeleaveme.com lr78.com lroid.com lukop.dk m4ilweb.info maboard.com mail-filter.com
mail-temporaire.fr mail.mezimages.net mail.tm mail1a.de mail21.cc mail2rss.org mail333.com mail4trash.com
mailbidon.com mailblocks.com mailbox.in.ua mailcatch.com maildrop.cc maildx.com maileater.com mailexpire.com
mailfa.tk mailforspam.com mailfreeonline.com mailguard.me mailimate.com mailin8r.com mailinater.com mailinator.com
mailinator.net mailinator.org mailinator2.com mailincubator.com mailismagic.com mailme24.com mailmetrash.com
mailmoat.com mailms.com mailnator.com mailnesia.com mailnull.com mailpick.biz mailpoof.com mailquack.com mailrock.biz
mailsac.com mailscrap.com mailseal.de mailsiphon.com mailslapping.com mailslite.com mailtemp.info mailtemporaire.com
mailtemporaire.fr mailto.plus mailtothis.com mailtrash.net mailzilla.com mailzilla.org makemetheking.com
manybrain.com mbx.cc mega.zik.dj meinspamschutz.de meltmail.com messagebeamer.de mezimages.net mierdamail.com
migmail.pl mintemail.com mjukglass.nu moakt.com moakt.ws mobi.web.id mohmal.com moncourrier.fr.nf monemail.fr.nf
monmail.fr.nf mt2009.com mt2014.com my10minutemail.com mycleaninbox.net mymail-in.net mymailoasis.com mynetstore.de
mypacks.net mypartyclip.de myphantomemail.com mysamp.de mytemp.email mytempemail.com mytempmail.com mytrashmail.com
nabuma.com nada.email nepwk.com nervmich.net nervtmich.net netmails.com netmails.net neverbox.com nice-4u.com
nincsmail.hu nmail.cf no-spam.ws noblepioneer.com nobulk.com noclickemail.com nogmailspam.info nomail.xl.cx
nomail2me.com nomorespamemails.com nospam.ze.tc nospam4.us nospamfor.us nospammail.net notmailinator.com
nowmymail.com nurfuerspam.de nwldx.com objectmail.com obobbo.com odnorazovoe.ru oneoffemail.com onewaymail.com
onlatedotcom.info oopi.org opayq.com ordinaryamerican.net ourklips.com outlawspam.com ovpn.to owlpic.com
pancakemail.com pjjkp.com plexolan.de pokemail.net politikerclub.de poofy.org pookmail.com privatdemail.net
proxymail.eu prtnx.com punkass.com putthisinyourspamdatabase.com pwrby.com qiott.com quickinbox.com quickmail.nl
rcpt.at reallymymail.com realtyalerts.ca recursor.net regbypass.com rejectmail.com rhyta.com rklips.com rmqkr.net
rover.info rppkn.com rteet.com rtrtr.com s0ny.net safersignup.de safetymail.info safetypost.de sandelf.de
saynotospams.com schafmail.de selfdestructingmail.com sendspamhere.com sharklasers.com shieldedmail.com
shiftmail.com shitmail.me shortmail.net skeefmail.com slaskpost.se slopsbox.com smashmail.de smellfear.com
snakemail.com sneakemail.com snkmail.com sofimail.com sofort-mail.de sogetthis.com soodonims.com spam.la spam.su
spam4.me spamail.de spamavert.com spambob.com spambob.net spambob.org spambog.com spambog.de spambog.ru spambox.info
spambox.us spamcannon.com spamcannon.net spamcero.com spamcon.org spamcorptastic.com spamcowboy.com spamcowboy.net
spamcowboy.org spamday.com spamex.com spamfree.eu spamfree24.com spamfree24.de spamfree24.eu spamfree24.info
spamfree24.net spamfree24.org spamgourmet.com spamgourmet.net spamgourmet.org spamherelots.com spamhereplease.com
spamhole.com spamify.com spaminator.de spamkill.info spaml.com spaml.de spammotel.com spamobox.com spamoff.de
spamsalad.in spamslicer.com spamspot.com spamthis.co.uk spamthisplease.com spamtrail.com spamtroll.net spoofmail.de
spymail.one stuffmail.de super-auswahl.de supergreatmail.com supermailer.jp superrito.com superstachel.de
suremail.info svk.jp tafmail.com tagyourself.com teewars.org teleworm.com teleworm.us temp-mail.io temp-mail.org
temp-mail.ru tempail.com tempalias.com tempe-mail.com tempemail.biz tempemail.co.za tempemail.com tempemail.net
tempinbox.co.uk tempinbox.com tempmail.co tempmail.de tempmail.dev tempmail.it tempmail.lol tempmail.net
tempmail.plus tempmail.us tempmail2.com tempmailaddress.com tempmaildemo.com tempmailer.com tempmailer.de
tempmailo.com tempomail.fr temporarily.de temporarioemail.com.br temporaryemail.net temporaryemail.us
temporaryforwarding.com temporaryinbox.com temporarymailaddress.com tempr.email tempthe.net thanksnospam.info
thankyou2010.com thc.st thelimestones.com thisisnotmyrealemail.com thismail.net throam.com throwam.com
throwawayemailaddress.com throwawaymail.com tilien.com tittbit.in tmail.ws tmailinator.com tmpmail.net tmpmail.org
toiea.com toomail.biz topranklist.de tradermail.info trash-amil.com trash-mail.at trash-mail.com trash-mail.de
trash2009.com trash2010.com trash2011.com trashdevil.com trashdevil.de trashemail.de trashmail.at trashmail.com
trashmail.de trashmail.io trashmail.me trashmail.net trashmail.org trashmail.ws trashmailer.com trashymail.com
trashymail.net trbvm.com trialmail.de tryalert.com turual.com twinmail.de txcct.com tyldd.com uggsrock.com
upliftnow.com uplipht.com uroid.com venompen.com veryrealemail.com viditag.com viewcastmedia.com viewcastmedia.net
viewcastmedia.org vjuum.com vomoto.com vpn.st vsimcard.com vubby.com walala.org walkmail.net webemail.me webm4il.info
wegwerfadresse.de wegwerfemail.com wegwerfemail.de wegwerfmail.de wegwerfmail.info wegwerfmail.net wegwerfmail.org
wh4f.org whatiaas.com whatpaas.com whyspam.me willhackforfood.biz willselfdestruct.com winemaven.info wronghead.com
wuuvo.com wuzup.net wuzupmail.net wwwnew.eu xagloo.com xemaps.com xents.com xmaily.com xoxy.net xyzfree.net
yapped.net yep.it yogamaven.com yomail.info yopmail.com yopmail.fr yopmail.net youmailr.com yuurok.com z1p.biz
zehnminuten.de zehnminutenmail.de zetmail.com zippymail.info zoaxe.com zoemail.org zomg.info
`;

export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set(LIST.split(/\s+/).filter(Boolean));
